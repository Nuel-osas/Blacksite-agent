import OpenAI from "openai";
import type { BalanceSnapshot } from "./types.js";
import { getSpendingSummary } from "./spending-policy.js";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

export interface AgentDecision {
  action: "transfer_sol" | "transfer_token" | "airdrop" | "mint_tokens" | "hold" | "check_balance";
  params: Record<string, string>;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are an autonomous AI agent managing a Solana wallet on devnet. You make financial decisions based on your role, current balances, and the state of other agents.

You MUST respond with valid JSON only — no markdown, no explanation outside JSON.

Response format:
{
  "action": "transfer_sol" | "transfer_token" | "airdrop" | "mint_tokens" | "hold" | "check_balance",
  "params": { ... },
  "reasoning": "Brief explanation"
}

Action params:
- transfer_sol: { "to": "<agent-name>", "amount": "<sol-amount>" }
- transfer_token: { "to": "<agent-name>", "alias": "<token-alias>", "amount": "<token-amount>" }
- airdrop: { "amount": "<sol-amount>" }
- mint_tokens: { "alias": "<token-alias>", "to": "<agent-name>", "amount": "<token-amount>" }
- hold: {}
- check_balance: {}

Rules:
- Never spend more than your spending limits allow
- Keep enough SOL for transaction fees (at least 0.05 SOL)
- Make decisions that align with your assigned role
- If balances are low, request an airdrop
- Prefer small, frequent transactions over large ones`;

function buildAgentContext(
  agentName: string,
  role: string,
  balances: BalanceSnapshot[],
  allAgents: string[],
  roundNumber: number,
): string {
  const myBalance = balances.find((b) => b.agent === agentName);
  const summary = getSpendingSummary(agentName, role);

  let ctx = `You are agent "${agentName}" with role "${role}".
Round: ${roundNumber}

Your balances:
- SOL: ${myBalance?.sol.toFixed(4) ?? "unknown"}`;

  if (myBalance?.tokens.length) {
    for (const t of myBalance.tokens) {
      ctx += `\n- ${t.alias}: ${t.balance}`;
    }
  }

  ctx += `

Spending limits:
- Max per tx: ${summary.limits.maxPerTransaction} SOL
- Hourly spent: ${summary.hourlySpent.toFixed(4)} SOL
- Hourly remaining: ${summary.hourlyRemaining.toFixed(4)} SOL

Other agents: ${allAgents.filter((a) => a !== agentName).join(", ")}

Other agent balances:`;

  for (const b of balances) {
    if (b.agent !== agentName) {
      const tokens = b.tokens.map((t) => `${t.alias}:${t.balance}`).join(", ") || "none";
      ctx += `\n- ${b.agent}: SOL=${b.sol.toFixed(4)}, tokens=${tokens}`;
    }
  }

  return ctx;
}

function cleanJson(text: string): string {
  return text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}

export async function getAgentDecision(
  agentName: string,
  role: string,
  balances: BalanceSnapshot[],
  allAgents: string[],
  roundNumber: number,
): Promise<AgentDecision> {
  const response = await openrouter.chat.completions.create({
    model: "openrouter/free",
    max_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildAgentContext(agentName, role, balances, allAgents, roundNumber) },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return JSON.parse(cleanJson(text)) as AgentDecision;
}

export async function parseVoiceIntent(transcript: string, availableAgents: string[]): Promise<AgentDecision> {
  const response = await openrouter.chat.completions.create({
    model: "openrouter/free",
    max_tokens: 1024,
    messages: [
      {
        role: "system",
        content: `You parse voice commands into Solana wallet actions. Available agents: ${availableAgents.join(", ")}.

Respond with JSON only:
{
  "action": "transfer_sol" | "transfer_token" | "airdrop" | "mint_tokens" | "hold" | "check_balance",
  "params": { ... },
  "reasoning": "what the user asked for"
}

For transfer_sol: { "from": "<agent>", "to": "<agent>", "amount": "<sol>" }
For airdrop: { "agent": "<agent>", "amount": "<sol>" }
For check_balance: { "agent": "<agent>" } or {} for all
For mint_tokens: { "alias": "<token>", "to": "<agent>", "amount": "<amount>" }`,
      },
      { role: "user", content: transcript },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return JSON.parse(cleanJson(text)) as AgentDecision;
}
