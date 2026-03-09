import {
  createAgent,
  formatAgentRow,
  getMintRecord,
  listAgents,
  loadAgentKeypair,
  loadState,
  upsertMintRecord,
} from "./keystore.js";
import { DEFAULT_RPC_URL } from "./config.js";
import { parseIntent } from "./intents.js";
import {
  bootstrapDemoAgents,
  describeBalances,
  getDemoPrerequisiteStatus,
  runDemoSimulation,
} from "./runtime.js";
import { createTokenMint, mintTokens, parseSol, requestAirdrop, transferSol } from "./solana.js";
import { runAutonomousLoop } from "./autonomous.js";
import { getSpendingSummary } from "./spending-policy.js";

const OUTPUT_LINE_LIMIT = 16;

export interface ShellResponse {
  summary: string;
  outputLines: string[];
  shouldExit?: boolean;
  clearActivity?: boolean;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatErrorLines(error: unknown): string[] {
  const message = getErrorMessage(error);
  if (message.includes("429 Too Many Requests")) {
    return [
      "Devnet RPC rate-limited the request.",
      `Current RPC: ${DEFAULT_RPC_URL}`,
      "Retry in a moment or set SOLANA_RPC_URL to a less crowded devnet provider.",
    ];
  }
  if (message.includes("fetch failed") || message.includes("failed to get balance of account")) {
    return [
      "RPC request failed while talking to Solana devnet.",
      `Current RPC: ${DEFAULT_RPC_URL}`,
      "Check your network connection or set SOLANA_RPC_URL to another devnet RPC endpoint.",
    ];
  }
  return [`Error: ${message}`];
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function limitLines(value: string, maxLines = OUTPUT_LINE_LIMIT): string[] {
  const lines = value.split("\n");
  if (lines.length <= maxLines) {
    return lines;
  }
  return [...lines.slice(0, maxLines - 1), `... (${lines.length - maxLines + 1} more lines)`];
}

function summarizeBalances(snapshot: Awaited<ReturnType<typeof describeBalances>>): string[] {
  if (snapshot.length === 0) {
    return ["No balances found."];
  }
  return snapshot.map((item) => {
    const tokens = item.tokens.length
      ? item.tokens.map((token) => `${token.alias}:${token.balance}`).join(", ")
      : "none";
    return `${item.agent.padEnd(12)} SOL=${item.sol.toFixed(4).padEnd(10)} tokens=${tokens}`;
  });
}

function extractFirstNumber(text: string): string | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? match[1] : null;
}

async function runIntent(text: string): Promise<unknown> {
  const intent = parseIntent(text);
  switch (intent.kind) {
    case "airdrop": {
      const { keypair } = await loadAgentKeypair(intent.agent);
      const signature = await requestAirdrop(keypair.publicKey, parseSol(intent.amountSol));
      return { intent, signature };
    }
    case "transfer-sol": {
      const sender = await loadAgentKeypair(intent.from);
      const recipient = await loadAgentKeypair(intent.to);
      const signature = await transferSol(
        sender.keypair,
        recipient.keypair.publicKey,
        parseSol(intent.amountSol),
        "intent-driven-transfer",
      );
      return { intent, signature };
    }
    case "create-mint": {
      const authority = await loadAgentKeypair(intent.authority);
      const address = await createTokenMint(authority.keypair, intent.decimals);
      await upsertMintRecord({
        alias: intent.alias,
        address,
        authorityAgent: intent.authority,
        decimals: intent.decimals,
        createdAt: new Date().toISOString(),
      });
      return { intent, address };
    }
    case "mint": {
      const mint = await getMintRecord(intent.alias);
      if (!mint) {
        throw new Error(`Mint alias "${intent.alias}" was not found.`);
      }
      const authority = await loadAgentKeypair(intent.authority);
      const recipient = await loadAgentKeypair(intent.recipient);
      const signature = await mintTokens(
        authority.keypair,
        mint.address,
        recipient.keypair.publicKey,
        intent.amount,
        "intent-driven-mint",
      );
      return { intent, signature };
    }
    case "simulate": {
      return runDemoSimulation(intent.rounds);
    }
    default: {
      const unreachable: never = intent;
      throw new Error(`Unhandled intent: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function helpLines(): string[] {
  return [
    "Talk naturally or use slash commands.",
    "Examples:",
    "/help",
    "/wallets",
    "/fund",
    "/bootstrap 0.2",
    "/balances",
    "/demo 2",
    "/ai 3              (AI autonomous rounds)",
    "/spending treasury  (view spending limits)",
    "give me the wallet to fund",
    "show balances",
    "run the demo",
    "transfer 0.2 sol from treasury to trader",
    "/quit",
  ];
}

async function buildFundingLines(target?: string): Promise<string[]> {
  const agents = await listAgents();
  const filtered = target ? agents.filter((agent) => agent.name === target) : agents;
  if (filtered.length === 0) {
    throw new Error(`No wallet found for "${target}".`);
  }
  const treasury = filtered.find((agent) => agent.name === "treasury") ?? filtered[0];
  const status = await getDemoPrerequisiteStatus().catch(() => null);

  const lines = [
    `Fund ${treasury.name} first: ${treasury.publicKey}`,
  ];

  if (!target) {
    lines.push(...filtered.filter((agent) => agent.name !== treasury.name).map((agent) => `${agent.name}: ${agent.publicKey}`));
  }

  if (status) {
    lines.push(
      `Treasury SOL: ${status.treasurySol.toFixed(4)} / minimum ${status.minimumTreasurySol.toFixed(4)} for the demo.`,
    );
  } else {
    lines.push("Treasury balance is unavailable because RPC could not be reached.");
  }

  return lines;
}

async function handleGreeting(): Promise<ShellResponse> {
  return {
    summary: "Displayed wallet assistant greeting.",
    outputLines: [
      "Wallet assistant is ready.",
      "Ask for balances, funding addresses, wallet creation, or demo actions.",
      "Try: give me the wallet to fund",
      "Try: run the demo",
      "Try: /help",
    ],
  };
}

export async function handleSlashCommand(rawInput: string): Promise<ShellResponse> {
  try {
    const tokens = rawInput.trim().split(/\s+/);
    const [command, ...args] = tokens;

    switch (command) {
      case "/help":
        return {
          summary: "Displayed wallet shell help.",
          outputLines: helpLines(),
        };
      case "/wallets": {
        const agents = await listAgents();
        return {
          summary: "Displayed wallet list.",
          outputLines:
            agents.length === 0 ? ["No agents created yet."] : ["name         role         publicKey", ...agents.map(formatAgentRow)],
        };
      }
      case "/fund":
        return {
          summary: args[0] ? `Displayed funding address for ${args[0]}.` : "Displayed funding addresses.",
          outputLines: await buildFundingLines(args[0]),
        };
      case "/bootstrap": {
        const amount = args[0] ?? "1";
        const result = await bootstrapDemoAgents(parseSol(amount));
        return {
          summary: `Bootstrap attempted at ${amount} SOL per wallet.`,
          outputLines: limitLines(prettyJson(result)),
        };
      }
      case "/balances": {
        const result = await describeBalances(args[0]);
        return {
          summary: args[0] ? `Fetched balances for ${args[0]}.` : "Fetched all balances.",
          outputLines: summarizeBalances(result),
        };
      }
      case "/airdrop": {
        if (args.length < 2) {
          throw new Error("Usage: /airdrop <agent> <amountSol>");
        }
        const { keypair } = await loadAgentKeypair(args[0]);
        const signature = await requestAirdrop(keypair.publicKey, parseSol(args[1]));
        return {
          summary: `Requested ${args[1]} SOL airdrop for ${args[0]}.`,
          outputLines: [`signature: ${signature}`],
        };
      }
      case "/demo": {
        const rounds = Number(args[0] ?? "2");
        const result = await runDemoSimulation(rounds);
        return {
          summary: `Ran autonomous demo for ${rounds} round(s).`,
          outputLines: limitLines(prettyJson(result)),
        };
      }
      case "/agent": {
        if (args[0] !== "create" || !args[1]) {
          throw new Error("Usage: /agent create <name> [role]");
        }
        const role = args[2] ?? "operator";
        const record = await createAgent(args[1], role);
        return {
          summary: `Created agent ${record.name}.`,
          outputLines: limitLines(prettyJson(record)),
        };
      }
      case "/ai": {
        const aiRounds = Number(args[0] ?? "2");
        const aiResult = await runAutonomousLoop(aiRounds);
        return {
          summary: `Ran AI autonomous mode for ${aiRounds} round(s).`,
          outputLines: limitLines(prettyJson(aiResult)),
        };
      }
      case "/spending": {
        if (!args[0]) {
          throw new Error("Usage: /spending <agent>");
        }
        const { record } = await loadAgentKeypair(args[0]);
        const spendSummary = getSpendingSummary(record.name, record.role);
        return {
          summary: `Displayed spending limits for ${args[0]}.`,
          outputLines: limitLines(prettyJson({ agent: record.name, role: record.role, ...spendSummary })),
        };
      }
      case "/state": {
        const state = await loadState();
        return {
          summary: "Displayed tracked state.",
          outputLines: limitLines(prettyJson(state)),
        };
      }
      case "/clear":
        return {
          summary: "Cleared output.",
          clearActivity: true,
          outputLines: ["Ready. Ask for balances, funding addresses, or demo actions."],
        };
      case "/quit":
      case "/exit":
        return {
          summary: "Exited wallet shell.",
          outputLines: ["Session closed."],
          shouldExit: true,
        };
      default:
        throw new Error(`Unknown slash command "${command}". Try /help.`);
    }
  } catch (error) {
    return {
      summary: "Wallet shell command failed.",
      outputLines: formatErrorLines(error),
    };
  }
}

export async function handleConversation(message: string): Promise<ShellResponse> {
  try {
    const text = message.trim();
    const normalized = text.toLowerCase();

    if (!text) {
      return {
        summary: "Ignored empty input.",
        outputLines: ["Ready."],
      };
    }

    if (/^(hi|hello|hey|yo|sup)\b/.test(normalized)) {
      return handleGreeting();
    }

    if (/^(bye|goodbye|exit|quit)\b/.test(normalized)) {
      return {
        summary: "Exited wallet shell.",
        outputLines: ["Session closed."],
        shouldExit: true,
      };
    }

    if (/(help|what can you do|show commands|show options)/.test(normalized)) {
      return {
        summary: "Displayed wallet assistant help.",
        outputLines: helpLines(),
      };
    }

    if (
      /(wallet to fund|which wallet should i fund|funding address|what wallet do i fund|give me the wallet to fund)/.test(
        normalized,
      )
    ) {
      return {
        summary: "Displayed recommended funding wallet.",
        outputLines: await buildFundingLines(),
      };
    }

    if (/(show wallets|list wallets|show agents|list agents|what wallets do we have|who are the agents)/.test(normalized)) {
      const agents = await listAgents();
      return {
        summary: "Displayed wallet list.",
        outputLines:
          agents.length === 0 ? ["No agents created yet."] : ["name         role         publicKey", ...agents.map(formatAgentRow)],
      };
    }

    if (/(show state|wallet state|tracked state)/.test(normalized)) {
      const state = await loadState();
      return {
        summary: "Displayed tracked state.",
        outputLines: limitLines(prettyJson(state)),
      };
    }

    if (/(show balances|check balances|what are the balances|how much sol)/.test(normalized)) {
      const agents = await listAgents();
      const target = agents.find((agent) => normalized.includes(agent.name))?.name;
      const balances = await describeBalances(target);
      return {
        summary: target ? `Fetched balances for ${target}.` : "Fetched all balances.",
        outputLines: summarizeBalances(balances),
      };
    }

    if (/(run ai|start ai|autonomous mode|ai mode|let the agents think)/.test(normalized)) {
      const rounds = Number(extractFirstNumber(normalized) ?? "2");
      const result = await runAutonomousLoop(rounds);
      return {
        summary: `Ran AI autonomous mode for ${rounds} round(s).`,
        outputLines: limitLines(prettyJson(result)),
      };
    }

    if (/(run the demo|start the demo|run demo|start demo|simulate)/.test(normalized)) {
      const rounds = Number(extractFirstNumber(normalized) ?? "2");
      const result = await runDemoSimulation(rounds);
      return {
        summary: `Ran autonomous demo for ${rounds} round(s).`,
        outputLines: limitLines(prettyJson(result)),
      };
    }

    if (/(bootstrap|airdrop the wallets|fund the demo wallets)/.test(normalized)) {
      const amount = extractFirstNumber(normalized) ?? "1";
      const result = await bootstrapDemoAgents(parseSol(amount));
      return {
        summary: `Bootstrap attempted at ${amount} SOL per wallet.`,
        outputLines: limitLines(prettyJson(result)),
      };
    }

    {
      const match = normalized.match(/(?:create|make|add)\s+(?:an?\s+)?agent\s+([a-z0-9-]+)(?:\s+(?:as|role)\s+([a-z0-9-]+))?/);
      if (match) {
        const role = match[2] ?? "operator";
        const record = await createAgent(match[1], role);
        return {
          summary: `Created agent ${record.name}.`,
          outputLines: limitLines(prettyJson(record)),
        };
      }
    }

    try {
      const result = await runIntent(text);
      return {
        summary: `Executed wallet action from chat: ${text}`,
        outputLines: limitLines(prettyJson(result)),
      };
    } catch {
      return {
        summary: "Assistant could not map the request to a wallet action.",
        outputLines: [
          "I couldn't map that request to a wallet action.",
          "Try:",
          "give me the wallet to fund",
          "show balances",
          "run the demo",
          "/help",
        ],
      };
    }
  } catch (error) {
    return {
      summary: "Wallet assistant request failed.",
      outputLines: formatErrorLines(error),
    };
  }
}
