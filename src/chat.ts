import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Content,
  type Part,
  type FunctionCallPart,
  type FunctionResponsePart,
} from "@google/generative-ai";

import { createAgent, listAgents, loadAgentKeypair, loadState, getMintRecord, upsertMintRecord } from "./keystore.js";
import { requestAirdrop, transferSol, transferTokens, mintTokens, createTokenMint, parseSol } from "./solana.js";
import { describeBalances, bootstrapDemoAgents, runDemoSimulation } from "./runtime.js";
import { runAutonomousLoop } from "./autonomous.js";
import { getSpendingSummary } from "./spending-policy.js";
import { DEFAULT_RPC_URL } from "./config.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

// ── ANSI helpers ──────────────────────────────────────────────
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const ORANGE = "\x1b[38;5;208m";

// ── Gemini tool declarations ──────────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "create_agent",
    description: "Create a new agent wallet with an encrypted keypair on Solana devnet.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING, description: "Agent name (lowercase, alphanumeric)" },
        role: { type: SchemaType.STRING, description: "Agent role: treasury, trader, observer, or operator" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_agents",
    description: "List all registered agents with their names, roles, and public keys.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "get_balances",
    description: "Get SOL and SPL token balances for one or all agents.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        agent: { type: SchemaType.STRING, description: "Optional agent name. Omit for all agents." },
      },
    },
  },
  {
    name: "airdrop_sol",
    description: "Request a devnet SOL airdrop to an agent wallet.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        agent: { type: SchemaType.STRING, description: "Agent name to receive the airdrop" },
        amount: { type: SchemaType.STRING, description: "Amount of SOL to airdrop" },
      },
      required: ["agent", "amount"],
    },
  },
  {
    name: "transfer_sol",
    description: "Transfer SOL from one agent to another on Solana devnet.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        from: { type: SchemaType.STRING, description: "Sender agent name" },
        to: { type: SchemaType.STRING, description: "Recipient agent name" },
        amount: { type: SchemaType.STRING, description: "Amount of SOL to transfer" },
        memo: { type: SchemaType.STRING, description: "Optional memo" },
      },
      required: ["from", "to", "amount"],
    },
  },
  {
    name: "create_token_mint",
    description: "Create a new SPL token mint on devnet controlled by an agent.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        alias: { type: SchemaType.STRING, description: "Short name/alias for this token" },
        authority_agent: { type: SchemaType.STRING, description: "Agent who controls the mint" },
        decimals: { type: SchemaType.NUMBER, description: "Token decimals (0-9)" },
      },
      required: ["alias", "authority_agent"],
    },
  },
  {
    name: "mint_tokens",
    description: "Mint SPL tokens to a recipient agent.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        alias: { type: SchemaType.STRING, description: "Token alias (must exist)" },
        authority_agent: { type: SchemaType.STRING, description: "Mint authority agent" },
        recipient_agent: { type: SchemaType.STRING, description: "Agent to receive tokens" },
        amount: { type: SchemaType.STRING, description: "Amount to mint" },
      },
      required: ["alias", "authority_agent", "recipient_agent", "amount"],
    },
  },
  {
    name: "transfer_tokens",
    description: "Transfer SPL tokens from one agent to another.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        alias: { type: SchemaType.STRING, description: "Token alias" },
        from: { type: SchemaType.STRING, description: "Sender agent name" },
        to: { type: SchemaType.STRING, description: "Recipient agent name" },
        amount: { type: SchemaType.STRING, description: "Amount to transfer" },
      },
      required: ["alias", "from", "to", "amount"],
    },
  },
  {
    name: "bootstrap_demo",
    description: "Create the default demo agents (treasury, trader, observer) and airdrop SOL to each.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        airdrop_amount: { type: SchemaType.STRING, description: "SOL to airdrop per agent (default 1)" },
      },
    },
  },
  {
    name: "run_demo_simulation",
    description: "Run the scripted demo simulation with token minting, transfers, and settlements.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        rounds: { type: SchemaType.NUMBER, description: "Number of simulation rounds (default 2)" },
      },
    },
  },
  {
    name: "run_ai_autonomous",
    description: "Run AI-powered autonomous mode where AI decides what each agent should do each round.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        rounds: { type: SchemaType.NUMBER, description: "Number of autonomous rounds (default 2)" },
      },
    },
  },
  {
    name: "get_spending_limits",
    description: "View spending policy and limits for an agent.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        agent: { type: SchemaType.STRING, description: "Agent name" },
      },
      required: ["agent"],
    },
  },
  {
    name: "get_wallet_state",
    description: "Get the full internal wallet state including tracked token mints.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
];

const SYSTEM_PROMPT = `You are an AI wallet assistant managing Solana devnet agent wallets. You help users create wallets, transfer SOL and tokens, run demos, and manage multi-agent autonomous flows.

You have tools to interact with the Solana blockchain on devnet. Use them to fulfill user requests. Be conversational but concise — explain what you're doing and report results clearly.

Key concepts:
- Agents are named wallets (e.g. "treasury", "trader", "observer") with encrypted keypairs
- Each agent has a role that determines its spending limits
- All operations happen on Solana devnet (no real money at risk)
- The demo creates 3 agents and runs autonomous token minting/transfer/settlement rounds

When the user asks to do something, use the appropriate tool. If you need to do multiple steps (e.g. create agents then airdrop), do them in sequence. Always report transaction signatures so the user can verify on-chain.

Current RPC: ${DEFAULT_RPC_URL}`;

// ── Tool execution ────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "create_agent": {
        const record = await createAgent(args.name as string, (args.role as string) ?? "operator");
        return JSON.stringify({ created: record.name, role: record.role, publicKey: record.publicKey });
      }
      case "list_agents": {
        const agents = await listAgents();
        if (agents.length === 0) return "No agents created yet.";
        return agents.map((a) => `${a.name} (${a.role}): ${a.publicKey}`).join("\n");
      }
      case "get_balances": {
        const snapshots = await describeBalances(args.agent as string | undefined);
        if (snapshots.length === 0) return "No agents found.";
        return snapshots.map((s) => {
          const tokens = s.tokens.length
            ? s.tokens.map((t) => `  ${t.alias}: ${t.balance}`).join("\n")
            : "  (no tokens)";
          return `${s.agent} (${s.publicKey}):\n  SOL: ${s.sol.toFixed(4)}\n${tokens}`;
        }).join("\n\n");
      }
      case "airdrop_sol": {
        const { keypair } = await loadAgentKeypair(args.agent as string);
        const sig = await requestAirdrop(keypair.publicKey, parseSol(args.amount as string));
        return JSON.stringify({ agent: args.agent, amount: args.amount, signature: sig });
      }
      case "transfer_sol": {
        const sender = await loadAgentKeypair(args.from as string);
        const recipient = await loadAgentKeypair(args.to as string);
        const sig = await transferSol(
          sender.keypair, recipient.keypair.publicKey,
          parseSol(args.amount as string),
          (args.memo as string) ?? undefined,
        );
        return JSON.stringify({ from: args.from, to: args.to, amount: args.amount, signature: sig });
      }
      case "create_token_mint": {
        const authority = await loadAgentKeypair(args.authority_agent as string);
        const decimals = (args.decimals as number) ?? 6;
        const address = await createTokenMint(authority.keypair, decimals);
        await upsertMintRecord({
          alias: args.alias as string,
          address,
          decimals,
          authorityAgent: args.authority_agent as string,
          createdAt: new Date().toISOString(),
        });
        return JSON.stringify({ alias: args.alias, address, decimals });
      }
      case "mint_tokens": {
        const mint = await getMintRecord(args.alias as string);
        if (!mint) return `Error: mint alias "${args.alias}" not found.`;
        const auth = await loadAgentKeypair(args.authority_agent as string);
        const recip = await loadAgentKeypair(args.recipient_agent as string);
        const sig = await mintTokens(auth.keypair, mint.address, recip.keypair.publicKey, args.amount as string);
        return JSON.stringify({ alias: args.alias, to: args.recipient_agent, amount: args.amount, signature: sig });
      }
      case "transfer_tokens": {
        const mint = await getMintRecord(args.alias as string);
        if (!mint) return `Error: mint alias "${args.alias}" not found.`;
        const sender = await loadAgentKeypair(args.from as string);
        const recip = await loadAgentKeypair(args.to as string);
        const sig = await transferTokens(sender.keypair, mint.address, recip.keypair.publicKey, args.amount as string);
        return JSON.stringify({ alias: args.alias, from: args.from, to: args.to, amount: args.amount, signature: sig });
      }
      case "bootstrap_demo": {
        const amount = parseSol((args.airdrop_amount as string) ?? "1");
        const results = await bootstrapDemoAgents(amount);
        return JSON.stringify(results, null, 2);
      }
      case "run_demo_simulation": {
        const rounds = (args.rounds as number) ?? 2;
        const result = await runDemoSimulation(rounds);
        return JSON.stringify(result, null, 2);
      }
      case "run_ai_autonomous": {
        const rounds = (args.rounds as number) ?? 2;
        const result = await runAutonomousLoop(rounds);
        return JSON.stringify(result, null, 2);
      }
      case "get_spending_limits": {
        const { record } = await loadAgentKeypair(args.agent as string);
        const summary = getSpendingSummary(record.name, record.role);
        return JSON.stringify({ agent: record.name, role: record.role, ...summary }, null, 2);
      }
      case "get_wallet_state": {
        const state = await loadState();
        return JSON.stringify(state, null, 2);
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ── Agentic loop (Gemini function calling) ────────────────────

async function agentLoop(history: Content[]): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: SYSTEM_PROMPT,
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
  });

  const chat = model.startChat({ history: history.slice(0, -1) });

  // Send the latest user message
  const lastUserContent = history[history.length - 1];
  const userText = lastUserContent.parts.map((p) => ("text" in p ? p.text : "")).join("");
  let response = await chat.sendMessage(userText);

  while (true) {
    const candidate = response.response.candidates?.[0];
    if (!candidate) return "(no response)";

    const parts = candidate.content.parts;

    // Check for function calls
    const functionCalls = parts.filter((p): p is FunctionCallPart => "functionCall" in p);

    if (functionCalls.length === 0) {
      // No tool calls — extract text and return
      const textParts = parts.filter((p) => "text" in p);
      const text = textParts.map((p) => ("text" in p ? p.text : "")).join("\n");
      // Update history with assistant response
      history.push({ role: "model", parts });
      return text || "(no response)";
    }

    // Execute each function call
    const functionResponses: FunctionResponsePart[] = [];

    for (const fc of functionCalls) {
      const fnName = fc.functionCall.name;
      const fnArgs = (fc.functionCall.args ?? {}) as Record<string, unknown>;

      process.stdout.write(`${DIM}  [${fnName}${Object.keys(fnArgs).length ? `: ${JSON.stringify(fnArgs)}` : ""}]${RESET}\n`);

      const result = await executeTool(fnName, fnArgs);
      functionResponses.push({
        functionResponse: {
          name: fnName,
          response: { result },
        },
      });
    }

    // Send function results back to Gemini
    response = await chat.sendMessage(functionResponses);
    // Loop continues until Gemini responds with text (no more function calls)
  }
}

// ── Box drawing ───────────────────────────────────────────────

function getTermWidth(): number {
  return output.columns ?? 80;
}

function getTermHeight(): number {
  return output.rows ?? 24;
}

function clearScreen(): void {
  if (output.isTTY) {
    output.write("\x1b[2J\x1b[H");
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function boxTitle(label: string, width: number): string {
  const stripped = stripAnsi(label);
  const dashesTotal = width - 4 - stripped.length;
  const left = Math.floor(dashesTotal / 2);
  const right = dashesTotal - left;
  return `${DIM}╭${"─".repeat(left)}${RESET} ${label} ${DIM}${"─".repeat(right)}╮${RESET}`;
}

function boxSplit(width: number, leftWidth: number): string {
  return `${DIM}├${"─".repeat(leftWidth)}┬${"─".repeat(width - leftWidth - 3)}┤${RESET}`;
}

function boxSplitBottom(width: number, leftWidth: number): string {
  return `${DIM}├${"─".repeat(leftWidth)}┴${"─".repeat(width - leftWidth - 3)}┤${RESET}`;
}

function boxRow(text: string, width: number): string {
  const stripped = stripAnsi(text);
  const pad = Math.max(0, width - 4 - stripped.length);
  return `${DIM}│${RESET} ${text}${" ".repeat(pad)} ${DIM}│${RESET}`;
}

function boxRowTwo(left: string, right: string, width: number, leftWidth: number): string {
  const strippedL = stripAnsi(left);
  const strippedR = stripAnsi(right);
  const padL = Math.max(0, leftWidth - 1 - strippedL.length);
  const rightColWidth = width - leftWidth - 3;
  const padR = Math.max(0, rightColWidth - 1 - strippedR.length);
  return `${DIM}│${RESET} ${left}${" ".repeat(padL)}${DIM}│${RESET} ${right}${" ".repeat(padR)}${DIM}│${RESET}`;
}

function boxBottom(width: number): string {
  return `${DIM}╰${"─".repeat(width - 2)}╯${RESET}`;
}

// ── Wallet art ────────────────────────────────────────────────

const WALLET_ART = [
  "  ┌──────────┐  ",
  "  │  ◎ ◎ ◎   │  ",
  "  │  SOLANA   │  ",
  "  │  WALLET   │  ",
  "  └──────────┘  ",
];

// ── Welcome screen ────────────────────────────────────────────

async function printWelcome(): Promise<void> {
  clearScreen();
  const width = getTermWidth();
  const leftWidth = Math.max(42, Math.floor(width * 0.55));
  const agents = await listAgents().catch(() => []);
  const state = await loadState().catch(() => ({ mints: {} }));
  const cwd = process.cwd().replace(homedir(), "~");

  console.log("");
  console.log(boxTitle(`${BOLD}Solana Agent Wallet v0.1.0${RESET}`, width));
  console.log(boxSplit(width, leftWidth));

  const leftLines: string[] = [
    "",
    `${BOLD}       Welcome to Agent Wallet!${RESET}`,
    "",
    ...WALLET_ART,
    "",
    `${DIM}Solana Devnet${RESET}`,
    `  ${cwd}`,
  ];

  const rightLines: string[] = [
    `${ORANGE}${BOLD}Tips for getting started${RESET}`,
    `Try ${CYAN}"bootstrap the demo"${RESET}`,
    `or ${CYAN}"create an agent called alice"${RESET}`,
    "",
    `${ORANGE}${BOLD}Capabilities${RESET}`,
    `${DIM}Create wallets, transfer SOL,${RESET}`,
    `${DIM}mint tokens, run autonomous${RESET}`,
    `${DIM}AI agents, voice commands${RESET}`,
    "",
    `${ORANGE}${BOLD}Status${RESET}`,
    `Agents: ${BOLD}${agents.length}${RESET}  Mints: ${BOLD}${Object.keys(state.mints).length}${RESET}`,
    `RPC: ${DIM}${DEFAULT_RPC_URL.replace("https://", "")}${RESET}`,
  ];

  const maxRows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < maxRows; i++) {
    console.log(boxRowTwo(
      leftLines[i] ?? "",
      rightLines[i] ?? "",
      width,
      leftWidth,
    ));
  }

  console.log(boxSplitBottom(width, leftWidth));
  console.log(boxRow("", width));
  console.log(boxRow(`${DIM}Talk naturally — I understand what you need.${RESET}`, width));
  console.log(boxRow(`${DIM}Type ${BOLD}exit${RESET}${DIM} to quit.${RESET}`, width));
  console.log(boxRow("", width));
  console.log(boxBottom(width));
  console.log("");
}

// ── Chat loop ─────────────────────────────────────────────────

export async function startChat(): Promise<void> {
  const rl = createInterface({ input, output, terminal: true });
  const history: Content[] = [];

  await printWelcome();

  try {
    while (true) {
      let userInput: string;
      try {
        userInput = (await rl.question(`${BOLD}${GREEN}❯${RESET} `)).trim();
      } catch {
        break;
      }

      if (!userInput) continue;
      if (/^(exit|quit|bye)$/i.test(userInput)) {
        console.log(`\n${DIM}Goodbye.${RESET}\n`);
        break;
      }

      history.push({ role: "user", parts: [{ text: userInput }] });

      process.stdout.write(`\n${DIM}  thinking...${RESET}\n`);

      try {
        const reply = await agentLoop(history);
        const lines = reply.split("\n");
        console.log("");
        for (const line of lines) {
          console.log(`  ${line}`);
        }
        console.log("");
        console.log(`${DIM}${"─".repeat(getTermWidth())}${RESET}`);
        console.log("");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.log(`\n${RED}  Error: ${msg}${RESET}\n`);
        history.pop();
      }
    }
  } finally {
    rl.close();
  }
}
