import type { ParsedIntent } from "./types.js";

export function parseIntent(input: string): ParsedIntent {
  const text = input.trim().toLowerCase();

  let m: RegExpMatchArray | null;

  // ── Bootstrap ───────────────────────────────────────────────
  // "bootstrap the demo", "bootstrap", "setup demo", "init demo", "bootstrap demo with 2 sol"
  m = text.match(/^(?:bootstrap|setup|init)(?:\s+(?:the\s+)?demo)?(?:\s+(?:with\s+)?([\d.]+)\s*sol)?$/);
  if (m) return { kind: "bootstrap", airdropAmount: m[1] ?? "1" };

  // ── Create agent ────────────────────────────────────────────
  // "create agent alice", "create agent bob as trader", "new agent charlie role treasury"
  m = text.match(/^(?:create|new|add)\s+(?:an?\s+)?agent\s+(?:called\s+|named\s+)?([a-z0-9_-]+)(?:\s+(?:as|role|with\s+role)\s+([a-z]+))?$/);
  if (m) return { kind: "create-agent", name: m[1], role: m[2] ?? "operator" };

  // ── List agents ─────────────────────────────────────────────
  // "list agents", "show agents", "agents", "who are the agents"
  if (/^(?:list|show|get|view|display)?\s*(?:all\s+)?agents$/.test(text) ||
      /^who\s+are\s+(?:the\s+)?agents/.test(text)) {
    return { kind: "list-agents" };
  }

  // ── Balances ────────────────────────────────────────────────
  // "show balances", "balances", "balance of treasury", "check balance for trader"
  // "show all balances", "how much sol does treasury have"
  m = text.match(/^(?:show|get|check|view|display)?\s*(?:all\s+)?balance[s]?(?:\s+(?:of|for)\s+([a-z0-9_-]+))?$/);
  if (m) return { kind: "balances", agent: m[1] };

  m = text.match(/^how\s+much\s+(?:sol\s+)?(?:does|do)\s+([a-z0-9_-]+)\s+have/);
  if (m) return { kind: "balances", agent: m[1] };

  // ── Airdrop ─────────────────────────────────────────────────
  // "airdrop 1 sol to trader", "airdrop 2 to treasury", "give treasury 1 sol", "fund trader 2 sol"
  m = text.match(/^(?:airdrop|drop|give|fund)\s+([\d.]+)\s*(?:sol\s+)?(?:to\s+)?([a-z0-9_-]+)$/);
  if (m) return { kind: "airdrop", amountSol: m[1], agent: m[2] };

  m = text.match(/^(?:airdrop|drop|give|fund)\s+([a-z0-9_-]+)\s+([\d.]+)\s*sol?$/);
  if (m) return { kind: "airdrop", amountSol: m[2], agent: m[1] };

  // ── Transfer SOL ────────────────────────────────────────────
  // "send 0.5 sol from treasury to trader", "transfer 1 sol from alice to bob"
  m = text.match(/^(?:send|transfer|move)\s+([\d.]+)\s*sol\s+from\s+([a-z0-9_-]+)\s+to\s+([a-z0-9_-]+)$/);
  if (m) return { kind: "transfer-sol", amountSol: m[1], from: m[2], to: m[3] };

  // "send treasury 0.5 sol to trader"
  m = text.match(/^(?:send|transfer)\s+([a-z0-9_-]+)\s+([\d.]+)\s*sol\s+to\s+([a-z0-9_-]+)$/);
  if (m) return { kind: "transfer-sol", amountSol: m[2], from: m[1], to: m[3] };

  // ── Create token mint ───────────────────────────────────────
  // "create token USDC with treasury", "create mint mytoken for treasury", "new token ABC authority treasury 9 decimals"
  m = text.match(/^(?:create|new)\s+(?:token|mint)\s+([a-z0-9_-]+)\s+(?:with|for|authority)\s+([a-z0-9_-]+)(?:\s+(?:with\s+)?(\d+)\s*decimals?)?$/);
  if (m) return { kind: "create-mint", alias: m[1], authority: m[2], decimals: m[3] ? Number(m[3]) : 6 };

  // ── Mint tokens ─────────────────────────────────────────────
  // "mint 1000 USDC to trader via treasury", "mint 500 mytoken to alice authority treasury"
  m = text.match(/^mint\s+([\d.]+)\s+([a-z0-9_-]+)\s+to\s+([a-z0-9_-]+)\s+(?:via|authority|with|from)\s+([a-z0-9_-]+)$/);
  if (m) return { kind: "mint", amount: m[1], alias: m[2], recipient: m[3], authority: m[4] };

  // ── Transfer tokens ─────────────────────────────────────────
  // "transfer 100 USDC from trader to observer", "send 50 mytoken from alice to bob"
  m = text.match(/^(?:send|transfer|move)\s+([\d.]+)\s+([a-z0-9_-]+)\s+from\s+([a-z0-9_-]+)\s+to\s+([a-z0-9_-]+)$/);
  if (m && isNaN(Number(m[2]))) {
    // m[2] is not a number, so it's a token alias (not "sol")
    if (m[2] === "sol") {
      return { kind: "transfer-sol", amountSol: m[1], from: m[3], to: m[4] };
    }
    return { kind: "transfer-token", amount: m[1], alias: m[2], from: m[3], to: m[4] };
  }

  // ── Run simulation ──────────────────────────────────────────
  // "run 2 demo rounds", "simulate 3 rounds", "run demo", "run simulation"
  m = text.match(/^(?:run|start)\s+(\d+)\s+(?:demo\s+)?rounds?$/);
  if (m) return { kind: "simulate", rounds: Number(m[1]) };

  m = text.match(/^(?:run|start)\s+(?:demo|simulation)(?:\s+(\d+)\s+rounds?)?$/);
  if (m) return { kind: "simulate", rounds: m[1] ? Number(m[1]) : 2 };

  m = text.match(/^(?:simulate)\s*(\d+)?\s*(?:rounds?)?$/);
  if (m) return { kind: "simulate", rounds: m[1] ? Number(m[1]) : 2 };

  // ── Autonomous AI rounds ────────────────────────────────────
  // "run 3 autonomous rounds", "autonomous mode", "ai mode 5 rounds", "run ai"
  m = text.match(/^(?:run\s+)?(\d+)\s+(?:autonomous|ai)\s+rounds?$/);
  if (m) return { kind: "autonomous", rounds: Number(m[1]) };

  m = text.match(/^(?:run\s+)?(?:autonomous|ai)\s*(?:mode)?(?:\s+(\d+)\s+rounds?)?$/);
  if (m) return { kind: "autonomous", rounds: m[1] ? Number(m[1]) : 2 };

  m = text.match(/^run\s+ai(?:\s+(\d+))?$/);
  if (m) return { kind: "autonomous", rounds: m[1] ? Number(m[1]) : 2 };

  // ── Spending limits ─────────────────────────────────────────
  // "spending limits for trader", "show spending for treasury", "limits treasury"
  m = text.match(/^(?:show\s+)?(?:spending|limits?)(?:\s+(?:limits?\s+)?(?:for|of)\s+)?([a-z0-9_-]+)$/);
  if (m) return { kind: "spending", agent: m[1] };

  // ── Wallet state ────────────────────────────────────────────
  // "state", "show state", "wallet state", "show wallet state"
  if (/^(?:show\s+)?(?:wallet\s+)?state$/.test(text)) {
    return { kind: "state" };
  }

  // ── Unknown ─────────────────────────────────────────────────
  throw new Error(
    `Could not understand: "${input}"\n\n` +
    `Try:\n` +
    `  "bootstrap the demo"\n` +
    `  "create agent alice as trader"\n` +
    `  "airdrop 2 sol to treasury"\n` +
    `  "send 0.5 sol from treasury to trader"\n` +
    `  "show balances"\n` +
    `  "create token USDC with treasury"\n` +
    `  "mint 1000 USDC to trader via treasury"\n` +
    `  "transfer 100 USDC from trader to observer"\n` +
    `  "run 3 autonomous rounds"\n` +
    `  "spending limits for trader"`,
  );
}
