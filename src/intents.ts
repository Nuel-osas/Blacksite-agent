import type { ParsedIntent } from "./types.js";

export function parseIntent(input: string): ParsedIntent {
  const text = input.trim().toLowerCase();

  let match = text.match(/^airdrop\s+([\d.]+)\s+sol\s+to\s+([a-z0-9-]+)$/);
  if (match) {
    return {
      kind: "airdrop",
      amountSol: match[1],
      agent: match[2],
    };
  }

  match = text.match(/^(?:send|transfer)\s+([\d.]+)\s+sol\s+from\s+([a-z0-9-]+)\s+to\s+([a-z0-9-]+)$/);
  if (match) {
    return {
      kind: "transfer-sol",
      amountSol: match[1],
      from: match[2],
      to: match[3],
    };
  }

  match = text.match(/^create\s+mint\s+([a-z0-9-]+)\s+for\s+([a-z0-9-]+)(?:\s+with\s+(\d+)\s+decimals?)?$/);
  if (match) {
    return {
      kind: "create-mint",
      alias: match[1],
      authority: match[2],
      decimals: match[3] ? Number(match[3]) : 6,
    };
  }

  match = text.match(/^mint\s+([\d.]+)\s+([a-z0-9-]+)\s+to\s+([a-z0-9-]+)\s+via\s+([a-z0-9-]+)$/);
  if (match) {
    return {
      kind: "mint",
      amount: match[1],
      alias: match[2],
      recipient: match[3],
      authority: match[4],
    };
  }

  match = text.match(/^run\s+(\d+)\s+demo\s+rounds?$/);
  if (match) {
    return {
      kind: "simulate",
      rounds: Number(match[1]),
    };
  }

  throw new Error(
    'Unsupported intent. Examples: "airdrop 1 sol to trader", "transfer 0.2 sol from treasury to trader", "run 2 demo rounds".',
  );
}
