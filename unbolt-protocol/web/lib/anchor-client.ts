import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../idl/unbolt.json";

// Get environment variables with validation
const getEnvVar = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
};

// Initialize constants with validation
const programIdStr = getEnvVar('NEXT_PUBLIC_PROGRAM_ID');
const usdcMintStr = getEnvVar('NEXT_PUBLIC_USDC_MINT');

export const PROGRAM_ID = new PublicKey(programIdStr);
export const USDC_MINT = new PublicKey(usdcMintStr);
export const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// Fixed: Program expects (idl, programId, provider)
export function getProgram(connection: Connection, wallet: any) {
  const provider = new AnchorProvider(
    connection,
    wallet,
    AnchorProvider.defaultOptions()
  );
  
  // Correct order: idl, programId, provider
  return new Program(idl as Idl, PROGRAM_ID, provider);
}

export function findGlobalConfigPDA() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global-config")],
    PROGRAM_ID
  )[0];
}

export function findUserDebtPDA(userPubkey: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user-debt"), userPubkey.toBuffer()],
    PROGRAM_ID
  )[0];
}