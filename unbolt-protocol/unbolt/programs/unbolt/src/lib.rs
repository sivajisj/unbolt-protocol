use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

declare_id!("BwkEjgnMoZe6xf99NyLYgqRn6AtPifG962BPgjybD3R2"); // Replace after `anchor keys list`

#[program]
pub mod unbolt {
    use super::*;

    pub fn initialize_global_config(
        ctx: Context<InitializeGlobalConfig>,
        protocol_fees_bps: u16, // Basis points (100 = 1%)
    ) -> Result<()> {
        let global_config = &mut ctx.accounts.global_config;
        global_config.admin = ctx.accounts.admin.key();
        global_config.vault_address = ctx.accounts.vault_address.key();
        global_config.usdc_mint = ctx.accounts.usdc_mint.key();
        global_config.protocol_fees_bps = protocol_fees_bps;
        global_config.total_active_debt = 0;
        global_config.total_protocol_fees_collected = 0;
        global_config.bump = ctx.bumps.global_config;

        Ok(())
    }

    pub fn initialize_user_debt_account(ctx: Context<InitializeUserDebtAccount>) -> Result<()> {
        let user_debt = &mut ctx.accounts.user_debt_account;
        let clock = Clock::get()?;

        user_debt.borrower = ctx.accounts.user.key();
        user_debt.borrowed_amount = 0;
        user_debt.stream_rate = 0; // tokens per second
        user_debt.last_update_timestamp = clock.unix_timestamp;
        user_debt.repayment_start_time = 0;
        user_debt.repayment_end_time = 0;
        user_debt.total_repaid = 0;
        user_debt.is_active = false;
        user_debt.bump = ctx.bumps.user_debt_account;

        Ok(())
    }

    pub fn initiate_loan(
        ctx: Context<InitiateLoan>,
        borrow_amount: u64,
        duration_seconds: u64, // Repayment period
    ) -> Result<()> {
        require!(borrow_amount > 0, UnboltError::InvalidAmount);
        require!(duration_seconds >= 3600, UnboltError::DurationTooShort); // Min 1 hour

        let global_config = &ctx.accounts.global_config;
        let user_debt = &mut ctx.accounts.user_debt_account;
        let clock = Clock::get()?;

        // Calculate stream rate (tokens per second)
        let stream_rate = borrow_amount / duration_seconds;
        require!(stream_rate > 0, UnboltError::StreamRateTooLow);

        // Calculate protocol fee
        let fee_amount = (borrow_amount * global_config.protocol_fees_bps as u64) / 10000;
        let net_disbursement = borrow_amount - fee_amount;

        // Transfer USDC from vault to user
        let transfer_cpi_accounts = TransferChecked {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_2022_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, transfer_cpi_accounts);

        token_2022::transfer_checked(cpi_ctx, net_disbursement, ctx.accounts.usdc_mint.decimals)?;

        // Update user debt account
        user_debt.borrowed_amount = borrow_amount;
        user_debt.stream_rate = stream_rate;
        user_debt.last_update_timestamp = clock.unix_timestamp;
        user_debt.repayment_start_time = clock.unix_timestamp;
        user_debt.repayment_end_time = clock.unix_timestamp + duration_seconds as i64;
        user_debt.is_active = true;

        // Update global config
        let global_config = &mut ctx.accounts.global_config;
        global_config.total_active_debt += borrow_amount;
        global_config.total_protocol_fees_collected += fee_amount;

        emit!(LoanInitiatedEvent {
            user: ctx.accounts.user.key(),
            amount: borrow_amount,
            stream_rate,
            duration: duration_seconds,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn process_repayment_stream(ctx: Context<ProcessRepaymentStream>) -> Result<()> {
        let user_debt = &mut ctx.accounts.user_debt_account;
        let clock = Clock::get()?;

        require!(user_debt.is_active, UnboltError::LoanNotActive);

        // Calculate how much should have been repaid by now
        let time_elapsed = (clock.unix_timestamp - user_debt.last_update_timestamp) as u64;
        let expected_repayment = time_elapsed * user_debt.stream_rate;

        if expected_repayment == 0 {
            return Ok(());
        }

        // Calculate actual repayment from user
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_2022_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token_2022::transfer_checked(cpi_ctx, expected_repayment, ctx.accounts.usdc_mint.decimals)?;

        // Update debt account
        user_debt.total_repaid += expected_repayment;
        user_debt.last_update_timestamp = clock.unix_timestamp;

        // Check if loan is fully repaid
        if user_debt.total_repaid >= user_debt.borrowed_amount {
            user_debt.is_active = false;
            user_debt.stream_rate = 0;

            // Update global stats
            let global_config = &mut ctx.accounts.global_config;
            global_config.total_active_debt -= user_debt.borrowed_amount;

            emit!(LoanRepaidEvent {
                user: ctx.accounts.user.key(),
                total_repaid: user_debt.total_repaid,
                timestamp: clock.unix_timestamp,
            });
        }

        emit!(RepaymentProcessedEvent {
            user: ctx.accounts.user.key(),
            amount_repaid: expected_repayment,
            remaining_debt: user_debt.borrowed_amount - user_debt.total_repaid,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn liquidate_overdue_loan(ctx: Context<LiquidateOverdueLoan>) -> Result<()> {
        let clock = Clock::get()?;

        require!(
            ctx.accounts.user_debt_account.is_active,
            UnboltError::LoanNotActive
        );
        require!(
            clock.unix_timestamp > ctx.accounts.user_debt_account.repayment_end_time + 86400,
            UnboltError::NotOverdueYet
        );

        // Calculate total owed including penalty (20% penalty)
        let amount_owed = ctx.accounts.user_debt_account.borrowed_amount
            - ctx.accounts.user_debt_account.total_repaid;
        let penalty = amount_owed * 20 / 100;
        let total_due = amount_owed + penalty;

        // Transfer from user's collateral (simplified - you'd have collateral account)
        let transfer_cpi_accounts = TransferChecked {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.liquidator.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_2022_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, transfer_cpi_accounts);

        token_2022::transfer_checked(cpi_ctx, total_due, ctx.accounts.usdc_mint.decimals)?;

        // Mark loan as liquidated
        let user_debt_mut = &mut ctx.accounts.user_debt_account;
        user_debt_mut.is_active = false;
        user_debt_mut.stream_rate = 0;

        // Update global stats
        let global_config = &mut ctx.accounts.global_config;
        global_config.total_active_debt -= user_debt_mut.borrowed_amount;

        emit!(LoanLiquidatedEvent {
            user: ctx.accounts.user.key(),
            liquidator: ctx.accounts.liquidator.key(),
            amount_recovered: total_due,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

// Account Structures
#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub vault_address: Pubkey,
    pub usdc_mint: Pubkey,
    pub protocol_fees_bps: u16, // Fee in basis points
    pub total_active_debt: u64,
    pub total_protocol_fees_collected: u64,
    pub bump: u8,
}

#[account]
pub struct UserDebtAccount {
    pub borrower: Pubkey,
    pub borrowed_amount: u64,
    pub stream_rate: u64, // Tokens per second
    pub last_update_timestamp: i64,
    pub repayment_start_time: i64,
    pub repayment_end_time: i64,
    pub total_repaid: u64,
    pub is_active: bool,
    pub bump: u8,
}

// Event Emitters
#[event]
pub struct LoanInitiatedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub stream_rate: u64,
    pub duration: u64,
    pub timestamp: i64,
}

#[event]
pub struct RepaymentProcessedEvent {
    pub user: Pubkey,
    pub amount_repaid: u64,
    pub remaining_debt: u64,
    pub timestamp: i64,
}

#[event]
pub struct LoanRepaidEvent {
    pub user: Pubkey,
    pub total_repaid: u64,
    pub timestamp: i64,
}

#[event]
pub struct LoanLiquidatedEvent {
    pub user: Pubkey,
    pub liquidator: Pubkey,
    pub amount_recovered: u64,
    pub timestamp: i64,
}

// Context Structures
#[derive(Accounts)]
pub struct InitializeGlobalConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Validated as vault address storage
    pub vault_address: AccountInfo<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<GlobalConfig>(),
        seeds = [b"global-config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub system_program: Program<'info, System>,
    pub token_2022_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct InitializeUserDebtAccount<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + std::mem::size_of::<UserDebtAccount>(),
        seeds = [b"user-debt", user.key().as_ref()],
        bump
    )]
    pub user_debt_account: Account<'info, UserDebtAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitiateLoan<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"global-config"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [b"user-debt", user.key().as_ref()],
        bump = user_debt_account.bump,
        constraint = user_debt_account.borrower == user.key(),
    )]
    pub user_debt_account: Account<'info, UserDebtAccount>,

    #[account(mut)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Vault authority for token transfers
    pub vault_authority: AccountInfo<'info>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub token_2022_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct ProcessRepaymentStream<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"global-config"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [b"user-debt", user.key().as_ref()],
        bump = user_debt_account.bump,
        constraint = user_debt_account.borrower == user.key(),
    )]
    pub user_debt_account: Account<'info, UserDebtAccount>,

    #[account(mut)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub token_2022_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct LiquidateOverdueLoan<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(mut)]
    pub user: SystemAccount<'info>, // Borrower being liquidated

    #[account(
        mut,
        seeds = [b"global-config"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [b"user-debt", user.key().as_ref()],
        bump = user_debt_account.bump,
        constraint = user_debt_account.borrower == user.key(),
    )]
    pub user_debt_account: Account<'info, UserDebtAccount>,

    #[account(mut)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    pub token_2022_program: Program<'info, Token2022>,
}

// Error Codes
#[error_code]
pub enum UnboltError {
    #[msg("Invalid borrow amount")]
    InvalidAmount,
    #[msg("Duration must be at least 1 hour")]
    DurationTooShort,
    #[msg("Stream rate too low - minimum 1 token per second")]
    StreamRateTooLow,
    #[msg("Loan is not active")]
    LoanNotActive,
    #[msg("Loan is not overdue yet")]
    NotOverdueYet,
}
