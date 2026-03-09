import { PublicKey } from "@solana/web3.js";

import { getMintRecord, loadState, ensureAgent, listAgents, loadAgentKeypair, upsertMintRecord } from "./keystore.js";
import { createTokenMint, getSolBalance, getTokenBalance, mintTokens, requestAirdrop, transferSol, transferTokens } from "./solana.js";
import type {
  BalanceSnapshot,
  BootstrapResult,
  DemoPrerequisiteStatus,
  MintRecord,
  SimulationResult,
  SimulationStep,
} from "./types.js";

export const DEFAULT_AGENT_ROLES = [
  { name: "treasury", role: "treasury" },
  { name: "trader", role: "trader" },
  { name: "observer", role: "observer" },
] as const;

const MINIMUM_TREASURY_SOL = 0.2;

async function ensureDefaultAgents(): Promise<void> {
  for (const item of DEFAULT_AGENT_ROLES) {
    await ensureAgent(item.name, item.role);
  }
}

async function ensureDemoMint(authorityAgent: string, alias: string): Promise<MintRecord> {
  const existing = await getMintRecord(alias);
  if (existing) {
    return existing;
  }
  const { keypair } = await loadAgentKeypair(authorityAgent);
  const mintAddress = await createTokenMint(keypair, 6);
  const record: MintRecord = {
    alias,
    address: mintAddress,
    decimals: 6,
    authorityAgent,
    createdAt: new Date().toISOString(),
  };
  await upsertMintRecord(record);
  return record;
}

export async function describeBalances(agentName?: string): Promise<BalanceSnapshot[]> {
  const state = await loadState();
  const agents = await listAgents();
  const filtered = agentName ? agents.filter((agent) => agent.name === agentName) : agents;

  const snapshots = await Promise.all(
    filtered.map(async (agent) => {
      const publicKey = new PublicKey(agent.publicKey);
      const sol = await getSolBalance(publicKey);
      const tokens = await Promise.all(
        Object.values(state.mints).map(async (mint) => ({
          alias: mint.alias,
          mint: mint.address,
          balance: await getTokenBalance(publicKey, mint.address),
        })),
      );
      return {
        agent: agent.name,
        publicKey: agent.publicKey,
        sol,
        tokens,
      };
    }),
  );

  return snapshots;
}

export async function bootstrapDemoAgents(airdropSol: number): Promise<BootstrapResult[]> {
  await ensureDefaultAgents();
  const results: BootstrapResult[] = [];
  for (const item of DEFAULT_AGENT_ROLES) {
    const { record } = await loadAgentKeypair(item.name);
    try {
      const signature = await requestAirdrop(new PublicKey(record.publicKey), airdropSol);
      results.push({
        agent: item.name,
        publicKey: record.publicKey,
        airdropSol,
        signature,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        agent: item.name,
        publicKey: record.publicKey,
        airdropSol,
        error: message,
      });
    }
  }
  return results;
}

export async function getDemoPrerequisiteStatus(): Promise<DemoPrerequisiteStatus> {
  await ensureDefaultAgents();
  const treasury = await loadAgentKeypair("treasury");
  const treasurySol = await getSolBalance(treasury.keypair.publicKey);
  return {
    treasuryPublicKey: treasury.record.publicKey,
    treasurySol,
    minimumTreasurySol: MINIMUM_TREASURY_SOL,
  };
}

export async function runDemoSimulation(rounds: number): Promise<SimulationResult> {
  if (rounds <= 0) {
    throw new Error("Simulation rounds must be greater than zero.");
  }

  await ensureDefaultAgents();
  const treasury = await loadAgentKeypair("treasury");
  const trader = await loadAgentKeypair("trader");
  const observer = await loadAgentKeypair("observer");
  const treasurySol = await getSolBalance(treasury.keypair.publicKey);
  if (treasurySol < MINIMUM_TREASURY_SOL) {
    throw new Error(
      [
        "Treasury wallet does not have enough SOL to run the demo.",
        `Fund treasury ${treasury.record.publicKey} with at least ${MINIMUM_TREASURY_SOL} SOL on devnet and retry.`,
      ].join(" "),
    );
  }

  const steps: SimulationStep[] = [];
  const mint = await ensureDemoMint("treasury", "sandbox");

  for (let round = 1; round <= rounds; round += 1) {
    const traderSol = await getSolBalance(trader.keypair.publicKey);
    if (traderSol < 0.25) {
      const signature = await transferSol(
        treasury.keypair,
        trader.keypair.publicKey,
        0.2,
        `agent-topup:trader:round-${round}`,
      );
      steps.push({
        round,
        description: "Treasury topped up trader SOL for transaction fees.",
        signature,
      });
    }

    const observerSol = await getSolBalance(observer.keypair.publicKey);
    if (observerSol < 0.15) {
      const signature = await transferSol(
        treasury.keypair,
        observer.keypair.publicKey,
        0.1,
        `agent-topup:observer:round-${round}`,
      );
      steps.push({
        round,
        description: "Treasury topped up observer SOL for settlement activity.",
        signature,
      });
    }

    const mintSignature = await mintTokens(
      treasury.keypair,
      mint.address,
      trader.keypair.publicKey,
      "25",
      `agent-mint:round-${round}`,
    );
    steps.push({
      round,
      description: "Treasury minted 25 SANDBOX tokens to the trader agent.",
      signature: mintSignature,
    });

    const transferSignature = await transferTokens(
      trader.keypair,
      mint.address,
      observer.keypair.publicKey,
      "10",
      `agent-transfer:round-${round}`,
    );
    steps.push({
      round,
      description: "Trader rebalanced 10 SANDBOX tokens to the observer agent.",
      signature: transferSignature,
    });

    const settlementSignature = await transferSol(
      observer.keypair,
      treasury.keypair.publicKey,
      0.01,
      `agent-settlement:round-${round}`,
    );
    steps.push({
      round,
      description: "Observer returned 0.01 SOL to treasury as a mock protocol settlement.",
      signature: settlementSignature,
    });
  }

  return {
    mintAlias: mint.alias,
    mintAddress: mint.address,
    steps,
    balances: await describeBalances(),
  };
}
