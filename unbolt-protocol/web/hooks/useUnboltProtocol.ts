import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { useCallback, useState } from "react";
import { getProgram, findUserDebtPDA, findGlobalConfigPDA, USDC_MINT } from "@/lib/anchor-client";

export function useUnboltProtocol() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);

  const initializeUserDebtAccount = useCallback(async () => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    
    setLoading(true);
    try {
      const program = getProgram(connection, wallet);
      const userDebtPDA = findUserDebtPDA(wallet.publicKey);
      
      const signature = await program.methods
        .initializeUserDebtAccount()
        .accounts({
          user: wallet.publicKey,
          userDebtAccount: userDebtPDA,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc();
      
      await connection.confirmTransaction(signature);
      
      return { signature, userDebtPDA };
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  const initiateLoan = useCallback(async (borrowAmount: number, durationSeconds: number) => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    
    setLoading(true);
    try {
      const program = getProgram(connection, wallet);
      const userDebtPDA = findUserDebtPDA(wallet.publicKey);
      const globalConfigPDA = findGlobalConfigPDA();
      
      // Get user's token account
      const userTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      // Get vault token account (you'll need to set this)
      const vaultTokenAccount = new PublicKey(process.env.NEXT_PUBLIC_VAULT_TOKEN_ACCOUNT!);
      
      const signature = await program.methods
        .initiateLoan(new anchor.BN(borrowAmount), new anchor.BN(durationSeconds))
        .accounts({
          user: wallet.publicKey,
          globalConfig: globalConfigPDA,
          userDebtAccount: userDebtPDA,
          vaultTokenAccount: vaultTokenAccount,
          userTokenAccount: userTokenAccount,
          vaultAuthority: new PublicKey(process.env.NEXT_PUBLIC_VAULT_AUTHORITY!),
          usdcMint: USDC_MINT,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        } as any)
        .rpc();
      
      await connection.confirmTransaction(signature);
      
      return { signature };
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  const processRepayment = useCallback(async () => {
    if (!wallet.publicKey) throw new Error("Wallet not connected");
    
    setLoading(true);
    try {
      const program = getProgram(connection, wallet);
      const userDebtPDA = findUserDebtPDA(wallet.publicKey);
      const globalConfigPDA = findGlobalConfigPDA();
      
      const userTokenAccount = await getAssociatedTokenAddress(
        USDC_MINT,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      
      const vaultTokenAccount = new PublicKey(process.env.NEXT_PUBLIC_VAULT_TOKEN_ACCOUNT!);
      
      const signature = await program.methods
        .processRepaymentStream()
        .accounts({
          user: wallet.publicKey,
          globalConfig: globalConfigPDA,
          userDebtAccount: userDebtPDA,
          vaultTokenAccount: vaultTokenAccount,
          userTokenAccount: userTokenAccount,
          usdcMint: USDC_MINT,
          token2022Program: TOKEN_2022_PROGRAM_ID,
        } as any)
        .rpc();
      
      await connection.confirmTransaction(signature);
      
      return { signature };
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  const fetchUserDebtAccount = useCallback(async () => {
    if (!wallet.publicKey) return null;
    
    try {
      const program = getProgram(connection, wallet);
      const userDebtPDA = findUserDebtPDA(wallet.publicKey);
      
      const account = await program.account.userDebtAccount.fetch(userDebtPDA);
      return account;
    } catch (error) {
      console.error("Failed to fetch debt account:", error);
      return null;
    }
  }, [connection, wallet]);

  return {
    initializeUserDebtAccount,
    initiateLoan,
    processRepayment,
    fetchUserDebtAccount,
    loading,
  };
}