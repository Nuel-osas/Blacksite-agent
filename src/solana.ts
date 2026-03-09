import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createMint,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";

import { DEFAULT_RPC_URL, MEMO_PROGRAM_ID } from "./config.js";

function getRpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL ?? clusterApiUrl("devnet");
}

export function getConnection(): Connection {
  return new Connection(getRpcUrl(), "confirmed");
}

function memoInstruction(memo?: string): TransactionInstruction | null {
  if (!memo) {
    return null;
  }
  return new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM_ID),
    keys: [],
    data: Buffer.from(memo, "utf8"),
  });
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid amount "${amount}".`);
  }
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount "${amount}" exceeds supported precision of ${decimals} decimals.`);
  }
  const normalizedFraction = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${normalizedFraction}`);
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) {
    return amount.toString();
  }
  const value = amount.toString().padStart(decimals + 1, "0");
  const whole = value.slice(0, -decimals) || "0";
  const fraction = value.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function parseSol(amount: string): number {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid SOL amount "${amount}".`);
  }
  return parsed;
}

export async function requestAirdrop(publicKey: PublicKey, amountSol: number): Promise<string> {
  const connection = getConnection();
  const signature = await connection.requestAirdrop(publicKey, Math.round(amountSol * LAMPORTS_PER_SOL));
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return signature;
}

export async function getSolBalance(publicKey: PublicKey): Promise<number> {
  const connection = getConnection();
  const lamports = await connection.getBalance(publicKey, "confirmed");
  return lamports / LAMPORTS_PER_SOL;
}

export async function transferSol(
  sender: Keypair,
  recipient: PublicKey,
  amountSol: number,
  memo?: string,
): Promise<string> {
  const connection = getConnection();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    }),
  );
  const memoIx = memoInstruction(memo);
  if (memoIx) {
    tx.add(memoIx);
  }
  return sendAndConfirmTransaction(connection, tx, [sender], { commitment: "confirmed" });
}

async function ensureAssociatedTokenAccount(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const existing = await connection.getAccountInfo(ata, "confirmed");
  if (existing) {
    return ata;
  }

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint),
  );
  await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  return ata;
}

export async function createTokenMint(authority: Keypair, decimals: number): Promise<string> {
  const connection = getConnection();
  const mint = await createMint(connection, authority, authority.publicKey, null, decimals, undefined, {
    commitment: "confirmed",
  });
  return mint.toBase58();
}

export async function mintTokens(
  authority: Keypair,
  mintAddress: string,
  recipient: PublicKey,
  amount: string,
  memo?: string,
): Promise<string> {
  const connection = getConnection();
  const mint = new PublicKey(mintAddress);
  const mintInfo = await getMint(connection, mint, "confirmed");
  const recipientAta = await ensureAssociatedTokenAccount(connection, authority, mint, recipient);
  const quantity = parseTokenAmount(amount, mintInfo.decimals);
  const tx = new Transaction().add(
    createMintToInstruction(mint, recipientAta, authority.publicKey, quantity),
  );
  const memoIx = memoInstruction(memo);
  if (memoIx) {
    tx.add(memoIx);
  }
  return sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
}

export async function transferTokens(
  sender: Keypair,
  mintAddress: string,
  recipient: PublicKey,
  amount: string,
  memo?: string,
): Promise<string> {
  const connection = getConnection();
  const mint = new PublicKey(mintAddress);
  const mintInfo = await getMint(connection, mint, "confirmed");
  const senderAta = await ensureAssociatedTokenAccount(connection, sender, mint, sender.publicKey);
  const recipientAta = await ensureAssociatedTokenAccount(connection, sender, mint, recipient);
  const quantity = parseTokenAmount(amount, mintInfo.decimals);
  const tx = new Transaction().add(
    createTransferCheckedInstruction(
      senderAta,
      mint,
      recipientAta,
      sender.publicKey,
      quantity,
      mintInfo.decimals,
    ),
  );
  const memoIx = memoInstruction(memo);
  if (memoIx) {
    tx.add(memoIx);
  }
  return sendAndConfirmTransaction(connection, tx, [sender], { commitment: "confirmed" });
}

export async function getTokenBalance(owner: PublicKey, mintAddress: string): Promise<string> {
  const connection = getConnection();
  const mint = new PublicKey(mintAddress);
  const ata = await getAssociatedTokenAddress(mint, owner);
  const account = await connection.getAccountInfo(ata, "confirmed");
  if (!account) {
    return "0";
  }
  const tokenAccount = await getAccount(connection, ata, "confirmed");
  const mintInfo = await getMint(connection, mint, "confirmed");
  return formatTokenAmount(tokenAccount.amount, mintInfo.decimals);
}
