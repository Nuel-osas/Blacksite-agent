import type { AgentRecord } from "./types.js";

export interface SpendingLimit {
  maxPerTransaction: number;
  maxPerHour: number;
  requireConfirmAbove: number;
}

const DEFAULT_LIMITS: Record<string, SpendingLimit> = {
  treasury: { maxPerTransaction: 5, maxPerHour: 20, requireConfirmAbove: 3 },
  trader:   { maxPerTransaction: 2, maxPerHour: 10, requireConfirmAbove: 1 },
  observer: { maxPerTransaction: 0.5, maxPerHour: 2, requireConfirmAbove: 0.25 },
  operator: { maxPerTransaction: 1, maxPerHour: 5, requireConfirmAbove: 0.5 },
};

const recentSpends: Map<string, Array<{ amount: number; timestamp: number }>> = new Map();

function getAgentSpends(agentName: string): Array<{ amount: number; timestamp: number }> {
  if (!recentSpends.has(agentName)) {
    recentSpends.set(agentName, []);
  }
  return recentSpends.get(agentName)!;
}

function pruneOldSpends(agentName: string): void {
  const spends = getAgentSpends(agentName);
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  recentSpends.set(agentName, spends.filter((s) => s.timestamp > oneHourAgo));
}

export function getLimitsForRole(role: string): SpendingLimit {
  return DEFAULT_LIMITS[role] ?? DEFAULT_LIMITS.operator;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation: boolean;
}

export function checkSpendingPolicy(agent: AgentRecord, amountSol: number): PolicyCheckResult {
  const limits = getLimitsForRole(agent.role);

  if (amountSol > limits.maxPerTransaction) {
    return {
      allowed: false,
      reason: `Amount ${amountSol} SOL exceeds per-tx limit of ${limits.maxPerTransaction} SOL for role "${agent.role}".`,
      requiresConfirmation: false,
    };
  }

  pruneOldSpends(agent.name);
  const spends = getAgentSpends(agent.name);
  const hourlyTotal = spends.reduce((sum, s) => sum + s.amount, 0);

  if (hourlyTotal + amountSol > limits.maxPerHour) {
    return {
      allowed: false,
      reason: `Hourly spend would be ${(hourlyTotal + amountSol).toFixed(4)} SOL, exceeding limit of ${limits.maxPerHour} SOL.`,
      requiresConfirmation: false,
    };
  }

  return { allowed: true, requiresConfirmation: amountSol > limits.requireConfirmAbove };
}

export function recordSpend(agentName: string, amountSol: number): void {
  getAgentSpends(agentName).push({ amount: amountSol, timestamp: Date.now() });
}

export function getSpendingSummary(agentName: string, role: string) {
  pruneOldSpends(agentName);
  const limits = getLimitsForRole(role);
  const hourlySpent = getAgentSpends(agentName).reduce((sum, s) => sum + s.amount, 0);
  return { limits, hourlySpent, hourlyRemaining: Math.max(0, limits.maxPerHour - hourlySpent) };
}
