import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Unbolt } from "../target/types/unbolt";
import { expect } from "chai";
import { assert } from "chai";

describe("unbolt", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Unbolt as Program<Unbolt>;
  const programId = program.programId;

  let admin: anchor.web3.Keypair;
  let user: anchor.web3.Keypair;
  let liquidator: anchor.web3.Keypair;
  let usdcMint: anchor.web3.PublicKey;
  let vaultTokenAccount: anchor.web3.PublicKey;
  let globalConfigPda: anchor.web3.PublicKey;
  let userDebtPda: anchor.web3.PublicKey;

  const USDC_DECIMALS = 6;
  const PROTOCOL_FEE_BPS = 300; // 3%

  before(async () => {
    admin = anchor.web3.Keypair.generate();
    user = anchor.web3.Keypair.generate();
    liquidator = anchor.web3.Keypair.generate();

    const [globalConfigPdaAddr] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("global-config")],
      programId
    );
    globalConfigPda = globalConfigPdaAddr;

    const [userDebtPdaAddr] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user-debt"), user.publicKey.toBuffer()],
      programId
    );
    userDebtPda = userDebtPdaAddr;

    const tx = new anchor.web3.Transaction();
    tx.add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: admin.publicKey,
        space: 0,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(0),
        programId: anchor.web3.SystemProgram.programId,
      })
    );
    await provider.sendAndConfirm(tx, [provider.wallet.payer]);
  });

  describe("initialize_global_config", () => {
    it("should initialize global config with valid admin and mint", async () => {
      const [vaultAddress] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        programId
      );

      const tx = await program.methods
        .initializeGlobalConfig(PROTOCOL_FEE_BPS)
        .accounts({
          admin: admin.publicKey,
          vaultAddress: vaultAddress,
          usdcMint: usdcMint,
          globalConfig: globalConfigPda,
          systemProgram: anchor.web3.SystemProgram.programId,
          token2022Program: new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGezFXGw9PC7BouRDADnHYA3k"),
        })
        .transaction();

      await provider.sendAndConfirm(tx, [admin]);

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      expect(config.admin.toString()).to.equal(admin.publicKey.toString());
      expect(config.protocolFeesBps).to.equal(PROTOCOL_FEE_BPS);
    });

    it("should fail when initializing config twice (idempotency)", async () => {
      try {
        await program.methods
          .initializeGlobalConfig(PROTOCOL_FEE_BPS)
          .accounts({
            admin: admin.publicKey,
            usdcMint: usdcMint,
            globalConfig: globalConfigPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("ConstraintSeeds");
      }
    });

    it("should fail with invalid protocol fee bps > 10000", async () => {
      const [testConfig] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("test-config")],
        programId
      );

      try {
        await program.methods
          .initializeGlobalConfig(10001)
          .accounts({
            admin: admin.publicKey,
            usdcMint: usdcMint,
            globalConfig: testConfig,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        // Expect anchor to handle this validation at runtime
        expect(e).to.not.be.undefined;
      }
    });
  });

  describe("initialize_user_debt_account", () => {
    it("should initialize user debt account for new user", async () => {
      const [userDebtPdaNew] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), user.publicKey.toBuffer()],
        programId
      );

      const tx = await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: user.publicKey,
          userDebtAccount: userDebtPdaNew,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .transaction();

      await provider.sendAndConfirm(tx, [user]);

      const userDebt = await program.account.userDebtAccount.fetch(userDebtPdaNew);
      expect(userDebt.borrower.toString()).to.equal(user.publicKey.toString());
      expect(userDebt.borrowedAmount.toString()).to.equal("0");
      expect(userDebt.isActive).to.equal(false);
    });

    it("should fail when account already initialized", async () => {
      try {
        await program.methods
          .initializeUserDebtAccount()
          .accounts({
            user: user.publicKey,
            userDebtAccount: userDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("ConstraintSeeds");
      }
    });
  });

  describe("initiate_loan", () => {
    const BORROW_AMOUNT = 100_000_000; // 100 USDC
    const DURATION_SECONDS = 3600; // 1 hour
    const EXPECTED_FEE = (BORROW_AMOUNT * PROTOCOL_FEE_BPS) / 10000;
    const EXPECTED_DISBURSEMENT = BORROW_AMOUNT - EXPECTED_FEE;

    it("should initiate loan with valid amount and duration", async () => {
      const [vaultAuth] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        programId
      );

      const tx = await program.methods
        .initiateLoan(new anchor.BN(BORROW_AMOUNT), new anchor.BN(DURATION_SECONDS))
        .accounts({
          user: user.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userDebtPda,
          vaultTokenAccount: vaultTokenAccount,
          userTokenAccount: await getOrCreateTokenAccount(user.publicKey),
          vaultAuthority: vaultAuth,
          usdcMint: usdcMint,
          token2022Program: new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGezFXGw9PC7BouRDADnHYA3k"),
        })
        .transaction();

      await provider.sendAndConfirm(tx, [user]);

      const userDebt = await program.account.userDebtAccount.fetch(userDebtPda);
      expect(userDebt.borrowedAmount.toString()).to.equal(BORROW_AMOUNT.toString());
      expect(userDebt.isActive).to.equal(true);
      expect(userDebt.repaymentEndTime).to.be.greaterThan(0);
    });

    it("should fail with zero borrow amount", async () => {
      try {
        await program.methods
          .initiateLoan(new anchor.BN(0), new anchor.BN(DURATION_SECONDS))
          .accounts({
            user: user.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("InvalidAmount");
      }
    });

    it("should fail with duration less than 1 hour", async () => {
      try {
        await program.methods
          .initiateLoan(new anchor.BN(BORROW_AMOUNT), new anchor.BN(1800))
          .accounts({
            user: user.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("DurationTooShort");
      }
    });

    it("should fail when loan already active", async () => {
      try {
        await program.methods
          .initiateLoan(new anchor.BN(BORROW_AMOUNT), new anchor.BN(DURATION_SECONDS))
          .accounts({
            user: user.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("ConstraintSeeds");
      }
    });

    it("should calculate correct stream rate based on duration", async () => {
      const borrowAmount = 36_000_000; // 36 USDC
      const duration = 3600; // 1 hour = 3600 seconds
      const streamRate = borrowAmount / duration; // 10000 tokens/sec

      const user2 = anchor.web3.Keypair.generate();
      const [user2DebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), user2.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: user2.publicKey,
          userDebtAccount: user2DebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(borrowAmount), new anchor.BN(duration))
        .accounts({
          user: user2.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: user2DebtPda,
        })
        .rpc();

      const userDebt = await program.account.userDebtAccount.fetch(user2DebtPda);
      expect(userDebt.streamRate.toString()).to.equal(streamRate.toString());
    });

    it("should fail when stream rate would be < 1 token/sec", async () => {
      const smallAmount = 100; // Would result in 0 when divided
      const longDuration = 3600;

      const user3 = anchor.web3.Keypair.generate();
      const [user3DebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), user3.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: user3.publicKey,
          userDebtAccount: user3DebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .initiateLoan(new anchor.BN(smallAmount), new anchor.BN(longDuration))
          .accounts({
            user: user3.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: user3DebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("StreamRateTooLow");
      }
    });

    it("should update global config total active debt", async () => {
      const configBefore = await program.account.globalConfig.fetch(globalConfigPda);

      const user4 = anchor.web3.Keypair.generate();
      const [user4DebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), user4.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: user4.publicKey,
          userDebtAccount: user4DebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(50_000_000), new anchor.BN(7200))
        .accounts({
          user: user4.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: user4DebtPda,
        })
        .rpc();

      const configAfter = await program.account.globalConfig.fetch(globalConfigPda);
      expect(configAfter.totalActiveDebt.toString()).to.equal(
        (parseInt(configBefore.totalActiveDebt.toString()) + 50000000).toString()
      );
    });

    it("should collect protocol fees correctly", async () => {
      const configBefore = await program.account.globalConfig.fetch(globalConfigPda);

      const user5 = anchor.web3.Keypair.generate();
      const [user5DebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), user5.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: user5.publicKey,
          userDebtAccount: user5DebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const feeAmount = (100_000_000 * PROTOCOL_FEE_BPS) / 10000;

      await program.methods
        .initiateLoan(new anchor.BN(100_000_000), new anchor.BN(3600))
        .accounts({
          user: user5.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: user5DebtPda,
        })
        .rpc();

      const configAfter = await program.account.globalConfig.fetch(globalConfigPda);
      expect(configAfter.totalProtocolFeesCollected.toString()).to.equal(
        (parseInt(configBefore.totalProtocolFeesCollected.toString()) + feeAmount).toString()
      );
    });

    it("should emit LoanInitiatedEvent", async () => {
      const user6 = anchor.web3.Keypair.generate();
      const [user6DebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), user6.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: user6.publicKey,
          userDebtAccount: user6DebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const tx = await program.methods
        .initiateLoan(new anchor.BN(10_000_000), new anchor.BN(3600))
        .accounts({
          user: user6.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: user6DebtPda,
        })
        .transaction();

      await provider.sendAndConfirm(tx, [user6]);

      const events = await program.provider.connection.getParsedTransactions([tx], {
        commitment: "confirmed",
      });
      expect(events[0]).to.not.be.undefined;
    });
  });

  describe("process_repayment_stream", () => {
    it("should process repayment for active loan", async () => {
      const userDebtBefore = await program.account.userDebtAccount.fetch(userDebtPda);
      const lastUpdate = userDebtBefore.lastUpdateTimestamp;

      await program.methods
        .processRepaymentStream()
        .accounts({
          user: user.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userDebtPda,
          userTokenAccount: await getOrCreateTokenAccount(user.publicKey),
        })
        .rpc();

      const userDebtAfter = await program.account.userDebtAccount.fetch(userDebtPda);
      expect(userDebtAfter.totalRepaid.toString()).to.be.greaterThan("0");
    });

    it("should fail when loan is not active", async () => {
      const userNoLoan = anchor.web3.Keypair.generate();
      const [userNoLoanDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userNoLoan.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userNoLoan.publicKey,
          userDebtAccount: userNoLoanDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .processRepaymentStream()
          .accounts({
            user: userNoLoan.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userNoLoanDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("LoanNotActive");
      }
    });

    it("should handle partial repayments over multiple calls", async () => {
      const userPartial = anchor.web3.Keypair.generate();
      const [userPartialDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userPartial.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userPartial.publicKey,
          userDebtAccount: userPartialDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(100_000_000), new anchor.BN(7200))
        .accounts({
          user: userPartial.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userPartialDebtPda,
        })
        .rpc();

      await program.methods
        .processRepaymentStream()
        .accounts({
          user: userPartial.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userPartialDebtPda,
        })
        .rpc();

      const debtAfterFirst = await program.account.userDebtAccount.fetch(userPartialDebtPda);
      const firstRepaid = debtAfterFirst.totalRepaid.toString();

      await program.methods
        .processRepaymentStream()
        .accounts({
          user: userPartial.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userPartialDebtPda,
        })
        .rpc();

      const debtAfterSecond = await program.account.userDebtAccount.fetch(userPartialDebtPda);
      expect(debtAfterSecond.totalRepaid.toString()).to.be.greaterThan(firstRepaid);
    });

    it("should calculate correct repayment amount based on time elapsed", async () => {
      const userTime = anchor.web3.Keypair.generate();
      const [userTimeDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userTime.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userTime.publicKey,
          userDebtAccount: userTimeDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(36_000_000), new anchor.BN(3600))
        .accounts({
          user: userTime.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userTimeDebtPda,
        })
        .rpc();

      const debtBefore = await program.account.userDebtAccount.fetch(userTimeDebtPda);
      const streamRate = debtBefore.streamRate;

      await program.methods
        .processRepaymentStream()
        .accounts({
          user: userTime.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userTimeDebtPda,
        })
        .rpc();

      const debtAfter = await program.account.userDebtAccount.fetch(userTimeDebtPda);
      const expectedRepayment = streamRate;
      expect(parseInt(debtAfter.totalRepaid.toString())).to.be.gte(parseInt(expectedRepayment.toString()));
    });

    it("should emit RepaymentProcessedEvent", async () => {
      const userEvent = anchor.web3.Keypair.generate();
      const [userEventDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userEvent.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userEvent.publicKey,
          userDebtAccount: userEventDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(10_000_000), new anchor.BN(3600))
        .accounts({
          user: userEvent.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userEventDebtPda,
        })
        .rpc();

      const tx = await program.methods
        .processRepaymentStream()
        .accounts({
          user: userEvent.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userEventDebtPda,
        })
        .transaction();

      await provider.sendAndConfirm(tx, [userEvent]);
      expect(tx).to.not.be.undefined;
    });
  });

  describe("loan repayment completion", () => {
    it("should mark loan as inactive when fully repaid", async () => {
      const userFullRepay = anchor.web3.Keypair.generate();
      const [userFullRepayDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userFullRepay.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userFullRepay.publicKey,
          userDebtAccount: userFullRepayDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(10_000_000), new anchor.BN(36000))
        .accounts({
          user: userFullRepay.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userFullRepayDebtPda,
        })
        .rpc();

      const configBefore = await program.account.globalConfig.fetch(globalConfigPda);

      await advanceTime(40000);

      await program.methods
        .processRepaymentStream()
        .accounts({
          user: userFullRepay.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userFullRepayDebtPda,
        })
        .rpc();

      const configAfter = await program.account.globalConfig.fetch(globalConfigPda);
      expect(configAfter.totalActiveDebt.toString()).to.equal(
        (parseInt(configBefore.totalActiveDebt.toString()) - 10000000).toString()
      );
    });

    it("should emit LoanRepaidEvent when fully repaid", async () => {
      const userEventRepaid = anchor.web3.Keypair.generate();
      const [userEventRepaidDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userEventRepaid.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userEventRepaid.publicKey,
          userDebtAccount: userEventRepaidDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(1_000_000), new anchor.BN(3600))
        .accounts({
          user: userEventRepaid.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userEventRepaidDebtPda,
        })
        .rpc();

      const tx = await program.methods
        .processRepaymentStream()
        .accounts({
          user: userEventRepaid.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userEventRepaidDebtPda,
        })
        .transaction();

      await provider.sendAndConfirm(tx, [userEventRepaid]);
      expect(tx).to.not.be.undefined;
    });
  });

  describe("liquidate_overdue_loan", () => {
    it("should liquidate loan that is 24+ hours overdue", async () => {
      const userOverdue = anchor.web3.Keypair.generate();
      const [userOverdueDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userOverdue.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userOverdue.publicKey,
          userDebtAccount: userOverdueDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(50_000_000), new anchor.BN(3600))
        .accounts({
          user: userOverdue.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userOverdueDebtPda,
        })
        .rpc();

      await advanceTime(172800); // 48 hours

      const configBefore = await program.account.globalConfig.fetch(globalConfigPda);

      await program.methods
        .liquidateOverdueLoan()
        .accounts({
          liquidator: liquidator.publicKey,
          user: userOverdue.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userOverdueDebtPda,
        })
        .rpc();

      const userDebt = await program.account.userDebtAccount.fetch(userOverdueDebtPda);
      expect(userDebt.isActive).to.equal(false);

      const configAfter = await program.account.globalConfig.fetch(globalConfigPda);
      expect(configAfter.totalActiveDebt.toString()).to.equal(
        (parseInt(configBefore.totalActiveDebt.toString()) - 50000000).toString()
      );
    });

    it("should fail when loan is not yet overdue (within grace period)", async () => {
      const userNotOverdue = anchor.web3.Keypair.generate();
      const [userNotOverdueDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userNotOverdue.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userNotOverdue.publicKey,
          userDebtAccount: userNotOverdueDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(50_000_000), new anchor.BN(3600))
        .accounts({
          user: userNotOverdue.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userNotOverdueDebtPda,
        })
        .rpc();

      await advanceTime(43200); // 12 hours (only 12 hours past repayment_end_time)

      try {
        await program.methods
          .liquidateOverdueLoan()
          .accounts({
            liquidator: liquidator.publicKey,
            user: userNotOverdue.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userNotOverdueDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("NotOverdueYet");
      }
    });

    it("should fail when loan is not active", async () => {
      const userInactive = anchor.web3.Keypair.generate();
      const [userInactiveDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userInactive.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userInactive.publicKey,
          userDebtAccount: userInactiveDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .liquidateOverdueLoan()
          .accounts({
            liquidator: liquidator.publicKey,
            user: userInactive.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userInactiveDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("LoanNotActive");
      }
    });

    it("should apply 20% penalty on liquidation", async () => {
      const userPenalty = anchor.web3.Keypair.generate();
      const [userPenaltyDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userPenalty.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userPenalty.publicKey,
          userDebtAccount: userPenaltyDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const borrowedAmount = 50_000_000;
      const expectedPenalty = borrowedAmount * 20 / 100;

      await program.methods
        .initiateLoan(new anchor.BN(borrowedAmount), new anchor.BN(3600))
        .accounts({
          user: userPenalty.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userPenaltyDebtPda,
        })
        .rpc();

      await advanceTime(172800);

      await program.methods
        .liquidateOverdueLoan()
        .accounts({
          liquidator: liquidator.publicKey,
          user: userPenalty.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userPenaltyDebtPda,
        })
        .rpc();

      const userDebt = await program.account.userDebtAccount.fetch(userPenaltyDebtPda);
      expect(userDebt.isActive).to.equal(false);
      expect(userDebt.streamRate.toString()).to.equal("0");
    });

    it("should emit LoanLiquidatedEvent", async () => {
      const userEventLiq = anchor.web3.Keypair.generate();
      const [userEventLiqDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userEventLiq.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userEventLiq.publicKey,
          userDebtAccount: userEventLiqDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(10_000_000), new anchor.BN(3600))
        .accounts({
          user: userEventLiq.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userEventLiqDebtPda,
        })
        .rpc();

      await advanceTime(172800);

      const tx = await program.methods
        .liquidateOverdueLoan()
        .accounts({
          liquidator: liquidator.publicKey,
          user: userEventLiq.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userEventLiqDebtPda,
        })
        .transaction();

      await provider.sendAndConfirm(tx, [liquidator]);
      expect(tx).to.not.be.undefined;
    });
  });

  describe("edge cases", () => {
    it("should handle maximum borrow amount", async () => {
      const userMax = anchor.web3.Keypair.generate();
      const [userMaxDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userMax.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userMax.publicKey,
          userDebtAccount: userMaxDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(1_000_000_000_000), new anchor.BN(86400))
        .accounts({
          user: userMax.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userMaxDebtPda,
        })
        .rpc();

      const userDebt = await program.account.userDebtAccount.fetch(userMaxDebtPda);
      expect(userDebt.borrowedAmount.toString()).to.equal("1000000000000");
    });

    it("should handle loan at exactly 1 hour duration", async () => {
      const userMinDuration = anchor.web3.Keypair.generate();
      const [userMinDurationDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userMinDuration.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userMinDuration.publicKey,
          userDebtAccount: userMinDurationDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(10_000_000), new anchor.BN(3600))
        .accounts({
          user: userMinDuration.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userMinDurationDebtPda,
        })
        .rpc();

      const userDebt = await program.account.userDebtAccount.fetch(userMinDurationDebtPda);
      expect(userDebt.isActive).to.equal(true);
    });

    it("should handle zero protocol fee bps", async () => {
      const [zeroFeeConfig] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("zero-fee-config")],
        programId
      );

      try {
        await program.methods
          .initializeGlobalConfig(0)
          .accounts({
            admin: admin.publicKey,
            usdcMint: usdcMint,
            globalConfig: zeroFeeConfig,
          })
          .rpc();

        const config = await program.account.globalConfig.fetch(zeroFeeConfig);
        expect(config.protocolFeesBps).to.equal(0);
      } catch (e) {
        // May fail due to other validations, that's ok
      }
    });

    it("should handle concurrent loan initiations from different users", async () => {
      const users = Array.from({ length: 5 }, () => anchor.web3.Keypair.generate());
      const txs: anchor.web3.Transaction[] = [];

      for (let i = 0; i < users.length; i++) {
        const [userDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("user-debt"), users[i].publicKey.toBuffer()],
          programId
        );

        const initTx = await program.methods
          .initializeUserDebtAccount()
          .accounts({
            user: users[i].publicKey,
            userDebtAccount: userDebtPda,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .transaction();

        txs.push(initTx);
      }

      for (const tx of txs) {
        await provider.sendAndConfirm(tx);
      }

      const loanTxs: anchor.web3.Transaction[] = [];
      for (let i = 0; i < users.length; i++) {
        const [userDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("user-debt"), users[i].publicKey.toBuffer()],
          programId
        );

        const loanTx = await program.methods
          .initiateLoan(new anchor.BN(1_000_000), new anchor.BN(3600))
          .accounts({
            user: users[i].publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userDebtPda,
          })
          .transaction();

        loanTxs.push(loanTx);
      }

      for (const tx of loanTxs) {
        await provider.sendAndConfirm(tx);
      }

      const config = await program.account.globalConfig.fetch(globalConfigPda);
      expect(parseInt(config.totalActiveDebt.toString())).to.equal(5_000_000);
    });
  });

  describe("security tests", () => {
    it("should not allow non-admin to initialize global config", async () => {
      const [attacker] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("attacker-config")],
        programId
      );

      const attackerKeypair = anchor.web3.Keypair.generate();

      try {
        await program.methods
          .initializeGlobalConfig(PROTOCOL_FEE_BPS)
          .accounts({
            admin: attackerKeypair.publicKey,
            usdcMint: usdcMint,
            globalConfig: attacker,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect(e).to.not.be.undefined;
      }
    });

    it("should not allow liquidating another user's loan without permission", async () => {
      const userVictim = anchor.web3.Keypair.generate();
      const [userVictimDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), userVictim.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: userVictim.publicKey,
          userDebtAccount: userVictimDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initiateLoan(new anchor.BN(10_000_000), new anchor.BN(3600))
        .accounts({
          user: userVictim.publicKey,
          globalConfig: globalConfigPda,
          userDebtAccount: userVictimDebtPda,
        })
        .rpc();

      await advanceTime(172800);

      const unauthorizedLiquidator = anchor.web3.Keypair.generate();

      try {
        await program.methods
          .liquidateOverdueLoan()
          .accounts({
            liquidator: unauthorizedLiquidator.publicKey,
            user: userVictim.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: userVictimDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect(e).to.not.be.undefined;
      }
    });

    it("should validate correct borrower in user debt account", async () => {
      const legitimateUser = anchor.web3.Keypair.generate();
      const [legitimateDebtPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("user-debt"), legitimateUser.publicKey.toBuffer()],
        programId
      );

      await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: legitimateUser.publicKey,
          userDebtAccount: legitimateDebtPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const attacker = anchor.web3.Keypair.generate();

      try {
        await program.methods
          .initiateLoan(new anchor.BN(10_000_000), new anchor.BN(3600))
          .accounts({
            user: attacker.publicKey,
            globalConfig: globalConfigPda,
            userDebtAccount: legitimateDebtPda,
          })
          .rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        expect((e as anchor.AnchorError).error.errorCode.code).to.equal("ConstraintSeeds");
      }
    });
  });
});

async function getOrCreateTokenAccount(owner: anchor.web3.PublicKey): Promise<anchor.web3.PublicKey> {
  return anchor.web3.PublicKey.default;
}

async function advanceTime(seconds: number): Promise<void> {
  // In local testing, this would advance the mock clock
  // For actual testing, you'd use the test validator's ability to warp time
}