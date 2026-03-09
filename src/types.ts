export interface AgentRecord {
  name: string;
  role: string;
  publicKey: string;
  encryptedSecretKey: string;
  salt: string;
  iv: string;
  authTag: string;
  createdAt: string;
}

export interface MintRecord {
  alias: string;
  address: string;
  decimals: number;
  authorityAgent: string;
  createdAt: string;
}

export interface WalletState {
  mints: Record<string, MintRecord>;
}

export interface BalanceSnapshot {
  agent: string;
  publicKey: string;
  sol: number;
  tokens: Array<{
    alias: string;
    mint: string;
    balance: string;
  }>;
}

export interface SimulationStep {
  round: number;
  description: string;
  signature?: string;
}

export interface SimulationResult {
  mintAlias: string;
  mintAddress: string;
  steps: SimulationStep[];
  balances: BalanceSnapshot[];
}

export interface BootstrapResult {
  agent: string;
  publicKey: string;
  airdropSol: number;
  signature?: string;
  error?: string;
}

export interface DemoPrerequisiteStatus {
  treasuryPublicKey: string;
  treasurySol: number;
  minimumTreasurySol: number;
}

export type ParsedIntent =
  | { kind: "airdrop"; agent: string; amountSol: string }
  | { kind: "transfer-sol"; from: string; to: string; amountSol: string }
  | { kind: "create-mint"; authority: string; alias: string; decimals: number }
  | { kind: "mint"; authority: string; alias: string; recipient: string; amount: string }
  | { kind: "transfer-token"; alias: string; from: string; to: string; amount: string }
  | { kind: "simulate"; rounds: number }
  | { kind: "create-agent"; name: string; role: string }
  | { kind: "list-agents" }
  | { kind: "balances"; agent?: string }
  | { kind: "bootstrap"; airdropAmount: string }
  | { kind: "autonomous"; rounds: number }
  | { kind: "spending"; agent: string }
  | { kind: "state" };
