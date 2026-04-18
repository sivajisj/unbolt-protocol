import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { Unbolt } from "../unbolt/target/types/unbolt";
import idl from "../unbolt/target/idl/unbolt.json";

async function main() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Create a new keypair
  const wallet = Keypair.generate();
  console.log("Wallet:", wallet.publicKey.toBase58());

  // Airdrop some SOL
  const airdropSig = await connection.requestAirdrop(wallet.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);
  console.log("Airdropped 2 SOL");

  // Create anchor provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    anchor.AnchorProvider.defaultOptions()
  );

  const program = new Program(idl as unknown as Unbolt, provider);

  const userDebtPDA = PublicKey.findProgramAddressSync(
    [Buffer.from("user-debt"), wallet.publicKey.toBuffer()],
    program.programId
  )[0];

  console.log("Initializing PDA for user:", userDebtPDA.toBase58());

  try {
    const tx = await program.methods
      .initializeUserDebtAccount()
      .accounts({
        user: wallet.publicKey,
        userDebtAccount: userDebtPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();
    
    console.log("Success! TX:", tx);
    process.exit(0);
  } catch (err) {
    console.error("Contract Error:", err);
    process.exit(1);
  }
}

main();
