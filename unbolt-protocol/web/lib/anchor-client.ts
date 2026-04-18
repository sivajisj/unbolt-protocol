import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Unbolt } from "../../unbolt/target/types/unbolt";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../unbolt/target/idl/unbolt.json";


const DEFAULT_PROGRAM_ID = "3bAYPYRFc3Dnc9AUnkJoYycckBTHzXStZRWnJxkok9Jz";
const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSQh8qR4LoqFvcLhC26sg7uQ4kT5gXSv";

const getEnvVar = (name: string, fallback: string): string => {
  return process.env[name] || fallback;
};

const programIdStr = getEnvVar('NEXT_PUBLIC_PROGRAM_ID', DEFAULT_PROGRAM_ID);
const usdcMintStr = getEnvVar('NEXT_PUBLIC_USDC_MINT', DEFAULT_USDC_MINT);

export const PROGRAM_ID = new PublicKey(programIdStr);
export const USDC_MINT = new PublicKey(usdcMintStr);
export const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// Fixed: Program expects (idl, programId, provider)
export function getProgram(connection: Connection, wallet: any): Program<Unbolt> {
  const provider = new AnchorProvider(
    connection,
    wallet,
    AnchorProvider.defaultOptions()
  );
  
  // Correct order: idl, provider
  return new Program(idl as unknown as Unbolt, provider);
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