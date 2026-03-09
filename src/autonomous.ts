import { listAgents, loadAgentKeypair, getMintRecord } from "./keystore.js";
import { getAgentDecision, type AgentDecision } from "./ai-engine.js";
import { checkSpendingPolicy, recordSpend } from "./spending-policy.js";
import { describeBalances } from "./runtime.js";
import {
  requestAirdrop,
  transferSol,
  transferTokens,
  mintTokens,
  parseSol,
} from "./solana.js";
import type { BalanceSnapshot } from "./types.js";

export interface AgentActionResult {
  agent: string;
  decision: AgentDecision;
  result: "executed" | "blocked" | "skipped" | "error";
  signature?: string;
  error?: string;
}

export interface AutonomousRoundResult {
  round: number;
  agentActions: AgentActionResult[];
}

async function executeDecision(
  agentName: string,
  decision: AgentDecision,
): Promise<Omit<AgentActionResult, "agent" | "decision">> {
  try {
    const { record, keypair } = await loadAgentKeypair(agentName);

    switch (decision.action) {
      case "hold":
      case "check_balance":
        return { result: "skipped" };

      case "airdrop": {
        const amount = parseSol(decision.params.amount ?? "1");
        const signature = await requestAirdrop(keypair.publicKey, amount);
        return { result: "executed", signature };
      }

      case "transfer_sol": {
        const amount = parseSol(decision.params.amount);
        const check = checkSpendingPolicy(record, amount);
        if (!check.allowed) return { result: "blocked", error: check.reason };

        const recipient = await loadAgentKeypair(decision.params.to);
        const signature = await transferSol(
          keypair, recipient.keypair.publicKey, amount,
          `autonomous:${agentName}:transfer`,
        );
        recordSpend(agentName, amount);
        return { result: "executed", signature };
      }

      case "transfer_token": {
        const mint = await getMintRecord(decision.params.alias);
        if (!mint) return { result: "error", error: `Mint "${decision.params.alias}" not found.` };
        const recipient = await loadAgentKeypair(decision.params.to);
        const signature = await transferTokens(
          keypair, mint.address, recipient.keypair.publicKey,
          decision.params.amount, `autonomous:${agentName}:token-transfer`,
        );
        return { result: "executed", signature };
      }

      case "mint_tokens": {
        const mint = await getMintRecord(decision.params.alias);
        if (!mint) return { result: "error", error: `Mint "${decision.params.alias}" not found.` };
        const recipient = await loadAgentKeypair(decision.params.to);
        const signature = await mintTokens(
          keypair, mint.address, recipient.keypair.publicKey,
          decision.params.amount, `autonomous:${agentName}:mint`,
        );
        return { result: "executed", signature };
      }

      default:
        return { result: "skipped" };
    }
  } catch (error) {
    return { result: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runAutonomousRound(roundNumber: number): Promise<AutonomousRoundResult> {
  const agents = await listAgents();
  const agentNames = agents.map((a) => a.name);
  const balances = await describeBalances();
  const agentActions: AgentActionResult[] = [];

  for (const agent of agents) {
    console.log(`\n[Round ${roundNumber}] Agent "${agent.name}" (${agent.role}) thinking...`);

    try {
      const decision = await getAgentDecision(agent.name, agent.role, balances, agentNames, roundNumber);
      console.log(`  Decision: ${decision.action} -- ${decision.reasoning}`);

      const outcome = await executeDecision(agent.name, decision);

      if (outcome.result === "executed") console.log(`  Executed. Sig: ${outcome.signature}`);
      else if (outcome.result === "blocked") console.log(`  Blocked: ${outcome.error}`);
      else if (outcome.result === "error") console.log(`  Error: ${outcome.error}`);
      else console.log(`  Skipped (${decision.action}).`);

      agentActions.push({ agent: agent.name, decision, ...outcome });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  AI error: ${msg}`);
      agentActions.push({
        agent: agent.name,
        decision: { action: "hold", params: {}, reasoning: `Error: ${msg}` },
        result: "error", error: msg,
      });
    }
  }

  return { round: roundNumber, agentActions };
}

export async function runAutonomousLoop(
  rounds: number,
  delayMs = 3000,
): Promise<{ rounds: AutonomousRoundResult[]; finalBalances: BalanceSnapshot[] }> {
  console.log(`\n${"=".repeat(45)}`);
  console.log(`  AI Autonomous Mode: ${rounds} rounds`);
  console.log(`${"=".repeat(45)}\n`);

  const results: AutonomousRoundResult[] = [];

  for (let i = 1; i <= rounds; i++) {
    console.log(`\n----- Round ${i}/${rounds} -----`);
    results.push(await runAutonomousRound(i));
    if (i < rounds && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  const finalBalances = await describeBalances();
  console.log(`\n${"=".repeat(45)}`);
  console.log(`  Autonomous Mode Complete`);
  console.log(`${"=".repeat(45)}\n`);

  return { rounds: results, finalBalances };
}
