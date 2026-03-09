import { clusterApiUrl } from "@solana/web3.js";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const APP_NAME = "prototype-ai-agent-wallet";
export const STORE_DIR = resolve(process.cwd(), ".agent-wallet");
export const AGENTS_DIR = join(STORE_DIR, "agents");
export const STATE_FILE = join(STORE_DIR, "state.json");
export const MASTER_KEY_FILE = join(STORE_DIR, "master.key");
export const DEFAULT_RPC_URL = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
export const MASTER_KEY_ENV = "AGENT_WALLET_MASTER_KEY";
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

export function ensureStoreLayout(): void {
  mkdirSync(AGENTS_DIR, { recursive: true });
}
