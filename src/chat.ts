import { emitKeypressEvents } from "node:readline";
import { homedir } from "node:os";
import OpenAI from "openai";

import { createAgent, listAgents, loadAgentKeypair, loadState, getMintRecord, upsertMintRecord } from "./keystore.js";
import { PublicKey } from "@solana/web3.js";
import { requestAirdrop, transferSol, transferTokens, mintTokens, createTokenMint, parseSol } from "./solana.js";
import { describeBalances, bootstrapDemoAgents, runDemoSimulation } from "./runtime.js";
import { runAutonomousLoop } from "./autonomous.js";
import { getSpendingSummary } from "./spending-policy.js";
import { DEFAULT_RPC_URL } from "./config.js";

// ── Log types ────────────────────────────────────────────────

type LogKind =
  | "system"
  | "info"
  | "user"
  | "assistant"
  | "warning"
  | "error"
  | "success"
  | "tool";

interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
}

const MAX_LOG_ENTRIES = 300;

// ── Color helpers (ANSI 256) ─────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  cyan: "\x1b[36m",
  cyanBright: "\x1b[96m",
  magenta: "\x1b[35m",
  magentaBright: "\x1b[95m",
  green: "\x1b[32m",
  greenBright: "\x1b[92m",
  yellow: "\x1b[33m",
  yellowBright: "\x1b[93m",
  red: "\x1b[31m",
  redBright: "\x1b[91m",
  white: "\x1b[37m",
  whiteBright: "\x1b[97m",
  gray: "\x1b[90m",
  bgBlack: "\x1b[40m",
  // 256 colors
  slate: "\x1b[38;5;146m",
  muted: "\x1b[38;5;243m",
  border: "\x1b[38;5;238m",
  headerAccent: "\x1b[38;5;75m",
  toolDot: "\x1b[38;5;141m",
  successDot: "\x1b[38;5;78m",
  inputBg: "\x1b[48;5;235m",
};

// ── Text utilities ───────────────────────────────────────────

function cols(): number {
  return process.stdout.columns || 80;
}

function rows(): number {
  return process.stdout.rows || 24;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function padRight(text: string, width: number): string {
  const plain = stripAnsi(text);
  return plain.length >= width ? text : text + " ".repeat(width - plain.length);
}

function trimToWidth(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return maxLen <= 3 ? text.slice(0, maxLen) : `${text.slice(0, maxLen - 3)}...`;
}

function wrapText(text: string, width: number): string[] {
  const result: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (rawLine.length <= width) {
      result.push(rawLine);
      continue;
    }
    let remaining = rawLine;
    while (remaining.length > width) {
      let breakAt = remaining.lastIndexOf(" ", width);
      if (breakAt <= 0) breakAt = width;
      result.push(remaining.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    }
    if (remaining) result.push(remaining);
  }
  return result;
}

function normalizeMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let l = line;
      if (/^\s*#{1,6}\s+/.test(l)) l = l.replace(/^(\s*)#{1,6}\s+/, "$1◦ ");
      else if (/^\s*[-*]\s+/.test(l)) l = l.replace(/^(\s*)[-*]\s+/, "$1• ");
      l = l.replace(/`([^`]+)`/g, "$1");
      l = l.replace(/\*\*([^*]+)\*\*/g, "$1");
      l = l.replace(/__([^_]+)__/g, "$1");
      l = l.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
      return l;
    })
    .join("\n");
}

// ── Entry prefixes & colors ──────────────────────────────────

function getPrefix(kind: LogKind): { plain: string; display: string } {
  switch (kind) {
    case "user":
      return { plain: "❯ ", display: `${c.cyanBright}❯${c.reset} ` };
    case "assistant":
      return { plain: "✦ ", display: `${c.magentaBright}✦${c.reset} ` };
    case "tool":
      return { plain: "● ", display: `${c.toolDot}●${c.reset} ` };
    case "success":
      return { plain: "✔ ", display: `${c.successDot}✔${c.reset} ` };
    case "error":
      return { plain: "✕ ", display: `${c.redBright}✕${c.reset} ` };
    case "warning":
      return { plain: "▲ ", display: `${c.yellowBright}▲${c.reset} ` };
    case "info":
      return { plain: "· ", display: `${c.slate}·${c.reset} ` };
    case "system":
      return { plain: "· ", display: `${c.gray}·${c.reset} ` };
    default:
      return { plain: "• ", display: `${c.dim}•${c.reset} ` };
  }
}

function colorize(kind: LogKind, text: string): string {
  switch (kind) {
    case "user":
      return `${c.cyan}${text}${c.reset}`;
    case "assistant":
      return `${c.white}${text}${c.reset}`;
    case "tool":
      return `${c.magenta}${text}${c.reset}`;
    case "success":
      return `${c.green}${text}${c.reset}`;
    case "error":
      return `${c.red}${text}${c.reset}`;
    case "warning":
      return `${c.yellow}${text}${c.reset}`;
    case "info":
      return `${c.slate}${text}${c.reset}`;
    case "system":
      return `${c.gray}${text}${c.reset}`;
    default:
      return `${c.dim}${text}${c.reset}`;
  }
}

// ── TerminalUI ───────────────────────────────────────────────

class TerminalUI {
  private logEntries: LogEntry[] = [];
  private nextId = 1;
  private input = "";
  private status = "Ready";
  private busy = false;
  private busyFrame = 0;
  private activity: string | null = null;
  private viewportTop: number | null = null;
  private lastBodyHeight = 0;
  private lastMessageLineCount = 0;
  private isStarted = false;
  private cleanedUp = false;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private submitHandler: ((value: string) => void) | null = null;
  private exitHandler: (() => void) | null = null;
  private readonly keypressHandler: (str: string, key: any) => void;
  private readonly resizeHandler: () => void;

  constructor() {
    this.keypressHandler = (str, key) => this.handleKeypress(str, key);
    this.resizeHandler = () => this.render();
  }

  onSubmit(handler: (value: string) => void): void {
    this.submitHandler = handler;
  }

  onExit(handler: () => void): void {
    this.exitHandler = handler;
  }

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;
    emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", this.keypressHandler);
    process.stdout.on("resize", this.resizeHandler);
    // Alternate screen buffer, hide cursor
    process.stdout.write("\x1b[?1049h\x1b[?25l");
    this.animationTimer = setInterval(() => this.tick(), 120);
    this.render();
  }

  stop(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    process.stdin.off("keypress", this.keypressHandler);
    process.stdout.off("resize", this.resizeHandler);
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    // Restore main screen, show cursor
    process.stdout.write("\x1b[2J\x1b[H\x1b[?25h\x1b[?1049l");
  }

  setBusy(busy: boolean, status?: string): void {
    this.busy = busy;
    if (!busy) this.busyFrame = 0;
    if (status) this.status = status;
    else if (!busy) this.status = "Ready";
    this.render();
  }

  setActivity(text: string | null): void {
    this.activity = text;
    this.render();
  }

  log(kind: LogKind, text: string): void {
    this.logEntries.push({ id: this.nextId++, kind, text: text.replace(/\r\n/g, "\n") });
    if (this.logEntries.length > MAX_LOG_ENTRIES) {
      this.logEntries = this.logEntries.slice(-MAX_LOG_ENTRIES);
    }
    this.viewportTop = null; // auto-scroll to bottom
    this.render();
  }

  appendToLast(text: string): void {
    if (this.logEntries.length === 0) return;
    this.logEntries[this.logEntries.length - 1].text += text;
    this.viewportTop = null;
    this.render();
  }

  private tick(): void {
    if (!this.isStarted || this.cleanedUp) return;
    if (this.busy) {
      this.busyFrame++;
      this.render();
    }
  }

  private handleKeypress(str: string, key: any): void {
    if (key?.ctrl && key?.name === "c") {
      this.exitHandler?.();
      return;
    }

    if (key?.name === "return") {
      const value = this.input.trim();
      this.input = "";
      this.render();
      if (value) this.submitHandler?.(value);
      return;
    }

    if (key?.name === "backspace") {
      this.input = this.input.slice(0, -1);
      this.render();
      return;
    }

    if (key?.name === "escape") {
      this.input = "";
      this.render();
      return;
    }

    // Scrolling
    if (key?.name === "up") { this.scrollBy(-1); return; }
    if (key?.name === "down") { this.scrollBy(1); return; }
    if (key?.name === "pageup") { this.scrollBy(-Math.max(3, Math.floor(this.lastBodyHeight / 2))); return; }
    if (key?.name === "pagedown") { this.scrollBy(Math.max(3, Math.floor(this.lastBodyHeight / 2))); return; }

    if (key?.ctrl && key?.name === "l") { this.render(); return; }

    if (typeof str === "string" && str && !key?.meta && !key?.ctrl) {
      this.input += str;
      this.render();
    }
  }

  private scrollBy(delta: number): void {
    if (this.lastMessageLineCount <= this.lastBodyHeight) return;
    const maxTop = Math.max(0, this.lastMessageLineCount - this.lastBodyHeight);
    const currentTop = this.viewportTop === null ? maxTop : this.viewportTop;
    const next = Math.max(0, Math.min(maxTop, currentTop + delta));
    this.viewportTop = next >= maxTop ? null : next;
    this.render();
  }

  private formatEntry(entry: LogEntry, width: number): string[] {
    const text = entry.kind === "assistant" ? normalizeMarkdown(entry.text) : entry.text;
    const prefix = getPrefix(entry.kind);
    const contPad = " ".repeat(prefix.plain.length);
    const avail = Math.max(8, width - prefix.plain.length);
    const wrapped = wrapText(text, avail);

    return wrapped.map((line, i) => {
      const colored = colorize(entry.kind, line);
      return i === 0 ? `${prefix.display}${colored}` : `${contPad}${colored}`;
    });
  }

  private render(): void {
    if (!this.isStarted || this.cleanedUp) return;

    const w = Math.max(60, cols());
    const h = Math.max(16, rows());
    const innerW = w - 2;

    // ── Header (4 lines) ──
    const cwd = process.cwd().replace(homedir(), "~");
    const rpc = DEFAULT_RPC_URL.replace("https://", "");
    const statusColor = this.busy ? `${c.yellowBright}` : `${c.greenBright}`;
    const borderChar = `${c.border}─${c.reset}`;
    const topBorder = `${c.border}╭${"─".repeat(innerW)}╮${c.reset}`;
    const botBorder = `${c.border}╰${"─".repeat(innerW)}╯${c.reset}`;

    const headerLine1 = `${c.border}│${c.reset} ${c.cyanBright}${c.bold}Agent Wallet${c.reset} ${c.gray}•${c.reset} ${c.magenta}Solana Devnet${c.reset}${" ".repeat(Math.max(0, innerW - 28))}${c.border}│${c.reset}`;
    const statusText = `${c.dim}STATUS${c.reset} ${statusColor}${this.status}${c.reset}`;
    const headerLine2 = `${c.border}│${c.reset} ${statusText}${" ".repeat(Math.max(0, innerW - stripAnsi(statusText).length - 1))}${c.border}│${c.reset}`;
    const headerLines = [topBorder, headerLine1, headerLine2, botBorder];

    // ── Activity line ──
    const activityLines: string[] = [];
    if (this.activity) {
      activityLines.push(`${c.dim}· ${trimToWidth(this.activity, innerW - 2)}${c.reset}`);
    }

    // ── Footer (input area, 4 lines) ──
    const footerDivider = `${c.border}${"─".repeat(w)}${c.reset}`;
    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const inputPrefix = this.busy
      ? `${c.bgBlack}${c.yellow} ${spinnerFrames[this.busyFrame % spinnerFrames.length]} ${c.reset}`
      : `${c.bgBlack}${c.cyan} › ${c.reset}`;
    const inputText = this.input
      ? `${c.inputBg}${c.whiteBright}${padRight(trimToWidth(this.input, w - 5), w - 4)}${c.reset}`
      : `${c.inputBg}${c.muted}${padRight("ask anything about your wallet...", w - 4)}${c.reset}`;
    const emptyLine = `${c.inputBg}${" ".repeat(w)}${c.reset}`;
    const contextLine = `${c.dim}${trimToWidth(`${rpc}  •  ${cwd}`, w)}${c.reset}`;
    const footerLines = [footerDivider, emptyLine, `${inputPrefix}${inputText}`, emptyLine, contextLine];

    // ── Message body ──
    const bodyHeight = Math.max(4, h - headerLines.length - activityLines.length - footerLines.length);
    const messageLines = this.logEntries.flatMap((entry, i) => {
      const lines = this.formatEntry(entry, innerW);
      // Add spacer between different kinds
      const next = this.logEntries[i + 1];
      if (next && entry.kind !== next.kind) lines.push("");
      return lines;
    });

    this.lastBodyHeight = bodyHeight;
    this.lastMessageLineCount = messageLines.length;

    let visibleLines: string[];
    if (messageLines.length === 0) {
      // Empty state
      visibleLines = this.buildEmptyState(innerW, bodyHeight);
    } else {
      const maxTop = Math.max(0, messageLines.length - bodyHeight);
      const top = this.viewportTop === null ? maxTop : Math.max(0, Math.min(maxTop, this.viewportTop));
      this.viewportTop = top >= maxTop ? null : top;
      visibleLines = messageLines.slice(top, top + bodyHeight);
    }

    // Pad to fill body
    while (visibleLines.length < bodyHeight) visibleLines.push("");

    const screen = [...headerLines, ...activityLines, ...visibleLines, ...footerLines].join("\n");
    process.stdout.write(`\x1b[2J\x1b[H${screen}`);
  }

  private buildEmptyState(width: number, maxLines: number): string[] {
    const cardW = Math.max(44, Math.min(width, 72));
    const innerCardW = cardW - 2;
    const leftPad = " ".repeat(Math.max(0, Math.floor((width - cardW) / 2)));
    const row = (content: string) => {
      const plain = stripAnsi(content);
      const pad = Math.max(0, innerCardW - plain.length);
      return `${leftPad}${c.border}│${c.reset} ${content}${" ".repeat(pad)}${c.border}│${c.reset}`;
    };

    const lines = [
      "",
      `${leftPad}${c.border}╭${"─".repeat(innerCardW)}╮${c.reset}`,
      row(`${c.cyanBright}${c.bold}Agent Wallet${c.reset}`),
      row(""),
      row(`${c.magentaBright}◎ ◎ ◎${c.reset}  ${c.gray}Solana Devnet${c.reset}`),
      row(""),
      row(`${c.dim}Try:${c.reset}  ${c.cyan}"bootstrap the demo"${c.reset}`),
      row(`      ${c.cyan}"create agent alice"${c.reset}`),
      row(`      ${c.cyan}"airdrop 2 SOL to treasury"${c.reset}`),
      row(`      ${c.cyan}"show balances"${c.reset}`),
      row(""),
      row(`${c.dim}Type /help for commands${c.reset}`),
      `${leftPad}${c.border}╰${"─".repeat(innerCardW)}╯${c.reset}`,
      "",
    ];

    return lines.slice(0, maxLines);
  }
}

// ── OpenRouter setup ─────────────────────────────────────────

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});
const MODEL = "openrouter/free";

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "create_agent", description: "Create a new agent wallet with an encrypted keypair on Solana devnet.", parameters: { type: "object", properties: { name: { type: "string", description: "Agent name (lowercase, alphanumeric)" }, role: { type: "string", description: "Agent role: treasury, trader, observer, or operator" } }, required: ["name"] } } },
  { type: "function", function: { name: "list_agents", description: "List all registered agents with their names, roles, and public keys.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_balances", description: "Get SOL and SPL token balances for one or all agents.", parameters: { type: "object", properties: { agent: { type: "string", description: "Optional agent name. Omit for all agents." } } } } },
  { type: "function", function: { name: "airdrop_sol", description: "Request a devnet SOL airdrop to an agent wallet.", parameters: { type: "object", properties: { agent: { type: "string", description: "Agent name" }, amount: { type: "string", description: "Amount of SOL" } }, required: ["agent", "amount"] } } },
  { type: "function", function: { name: "transfer_sol", description: "Transfer SOL from one agent to another on Solana devnet.", parameters: { type: "object", properties: { from: { type: "string", description: "Sender agent" }, to: { type: "string", description: "Recipient agent" }, amount: { type: "string", description: "SOL amount" }, memo: { type: "string", description: "Optional memo" } }, required: ["from", "to", "amount"] } } },
  { type: "function", function: { name: "create_token_mint", description: "Create a new SPL token mint on devnet.", parameters: { type: "object", properties: { alias: { type: "string", description: "Token alias" }, authority_agent: { type: "string", description: "Mint authority agent" }, decimals: { type: "number", description: "Token decimals (0-9)" } }, required: ["alias", "authority_agent"] } } },
  { type: "function", function: { name: "mint_tokens", description: "Mint SPL tokens to a recipient agent.", parameters: { type: "object", properties: { alias: { type: "string", description: "Token alias" }, authority_agent: { type: "string", description: "Mint authority" }, recipient_agent: { type: "string", description: "Recipient" }, amount: { type: "string", description: "Amount to mint" } }, required: ["alias", "authority_agent", "recipient_agent", "amount"] } } },
  { type: "function", function: { name: "transfer_tokens", description: "Transfer SPL tokens between agents.", parameters: { type: "object", properties: { alias: { type: "string", description: "Token alias" }, from: { type: "string", description: "Sender" }, to: { type: "string", description: "Recipient" }, amount: { type: "string", description: "Amount" } }, required: ["alias", "from", "to", "amount"] } } },
  { type: "function", function: { name: "bootstrap_demo", description: "Create demo agents (treasury, trader, observer). Does NOT airdrop SOL — the user funds agents separately with airdrop_sol if needed.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "run_demo_simulation", description: "Run scripted demo simulation.", parameters: { type: "object", properties: { rounds: { type: "number", description: "Number of rounds (default 2)" } } } } },
  { type: "function", function: { name: "run_ai_autonomous", description: "Run AI autonomous mode.", parameters: { type: "object", properties: { rounds: { type: "number", description: "Number of rounds (default 2)" } } } } },
  { type: "function", function: { name: "get_spending_limits", description: "View spending policy for an agent.", parameters: { type: "object", properties: { agent: { type: "string", description: "Agent name" } }, required: ["agent"] } } },
  { type: "function", function: { name: "transfer_sol_to_address", description: "Transfer SOL from an agent to any external Solana public key address.", parameters: { type: "object", properties: { from: { type: "string", description: "Sender agent name" }, to_address: { type: "string", description: "Recipient Solana public key (base58)" }, amount: { type: "string", description: "SOL amount" }, memo: { type: "string", description: "Optional memo" } }, required: ["from", "to_address", "amount"] } } },
  { type: "function", function: { name: "transfer_tokens_to_address", description: "Transfer SPL tokens from an agent to any external Solana public key address.", parameters: { type: "object", properties: { alias: { type: "string", description: "Token alias" }, from: { type: "string", description: "Sender agent name" }, to_address: { type: "string", description: "Recipient Solana public key (base58)" }, amount: { type: "string", description: "Amount" } }, required: ["alias", "from", "to_address", "amount"] } } },
  { type: "function", function: { name: "get_wallet_state", description: "Get full wallet state including tracked mints.", parameters: { type: "object", properties: {} } } },
];

const SYSTEM_PROMPT = `You are an autonomous AI agent managing Solana devnet wallets. You are not an assistant — you are an agent that executes onchain operations. Be direct, concise, and action-oriented. Skip greetings, emojis, and filler.

You have tools to interact with the Solana blockchain on devnet. When the user asks for something, execute it. Report results with transaction signatures.

Key rules:
- Agents are named wallets (e.g. "treasury", "trader", "observer") with encrypted keypairs
- Each agent has a role that determines its spending limits
- All operations happen on Solana devnet (no real money at risk)
- bootstrap_demo creates 3 agents but does NOT airdrop SOL — only airdrop if the user explicitly asks
- You can send SOL/tokens to registered agents (by name) or external Solana addresses (by public key)
- If the recipient looks like a base58 public key, use transfer_sol_to_address or transfer_tokens_to_address
- If the recipient is an agent name, use transfer_sol or transfer_tokens
- Do not offer unsolicited suggestions or ask "would you like me to..." — just do what was asked

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
        return agents.map((ag) => `${ag.name} (${ag.role}): ${ag.publicKey}`).join("\n");
      }
      case "get_balances": {
        const snapshots = await describeBalances(args.agent as string | undefined);
        if (snapshots.length === 0) return "No agents found.";
        return snapshots.map((s) => {
          const tokens = s.tokens.length ? s.tokens.map((t) => `  ${t.alias}: ${t.balance}`).join("\n") : "  (no tokens)";
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
        const sig = await transferSol(sender.keypair, recipient.keypair.publicKey, parseSol(args.amount as string), (args.memo as string) ?? undefined);
        return JSON.stringify({ from: args.from, to: args.to, amount: args.amount, signature: sig });
      }
      case "create_token_mint": {
        const authority = await loadAgentKeypair(args.authority_agent as string);
        const decimals = (args.decimals as number) ?? 6;
        const address = await createTokenMint(authority.keypair, decimals);
        await upsertMintRecord({ alias: args.alias as string, address, decimals, authorityAgent: args.authority_agent as string, createdAt: new Date().toISOString() });
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
      case "transfer_sol_to_address": {
        const sender = await loadAgentKeypair(args.from as string);
        const recipientPk = new PublicKey(args.to_address as string);
        const sig = await transferSol(sender.keypair, recipientPk, parseSol(args.amount as string), (args.memo as string) ?? undefined);
        return JSON.stringify({ from: args.from, to_address: args.to_address, amount: args.amount, signature: sig });
      }
      case "transfer_tokens_to_address": {
        const mint = await getMintRecord(args.alias as string);
        if (!mint) return `Error: mint alias "${args.alias}" not found.`;
        const sender = await loadAgentKeypair(args.from as string);
        const recipientPk = new PublicKey(args.to_address as string);
        const sig = await transferTokens(sender.keypair, mint.address, recipientPk, args.amount as string);
        return JSON.stringify({ alias: args.alias, from: args.from, to_address: args.to_address, amount: args.amount, signature: sig });
      }
      case "bootstrap_demo": {
        const results = await bootstrapDemoAgents();
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

// ── Agentic loop ─────────────────────────────────────────────

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

async function agentLoop(
  messages: Message[],
  ui: TerminalUI,
): Promise<string> {
  let response = await openrouter.chat.completions.create({
    model: MODEL,
    messages,
    tools: TOOLS,
    tool_choice: "auto",
    max_tokens: 4096,
  });

  while (response.choices[0]?.finish_reason === "tool_calls") {
    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls ?? [];
    for (const tc of toolCalls) {
      if (tc.type !== "function") continue;
      const fnName = tc.function.name;
      const fnArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;

      ui.log("tool", `${fnName} ${Object.keys(fnArgs).length ? JSON.stringify(fnArgs) : ""}`);
      ui.setActivity(`Running ${fnName}...`);

      const result = await executeTool(fnName, fnArgs);

      ui.log("success", `${fnName} done`);
      ui.setActivity(null);

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }

    response = await openrouter.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 4096,
    });
  }

  const finalMsg = response.choices[0]?.message;
  if (finalMsg) messages.push(finalMsg);

  return finalMsg?.content ?? "(no response)";
}

// ── Help ─────────────────────────────────────────────────────

function showHelp(ui: TerminalUI): void {
  ui.log("info", [
    "Commands:",
    "  /help       Show this help",
    "  /clear      Clear conversation",
    "  /history    Show message count",
    "  /quit       Exit",
    "",
    "Talk naturally:",
    '  "bootstrap the demo"',
    '  "create agent alice as trader"',
    '  "airdrop 2 SOL to treasury"',
    '  "send 0.5 SOL from treasury to trader"',
    '  "show balances"',
    '  "create token USDC with treasury"',
    '  "mint 1000 USDC to trader"',
    '  "run 3 autonomous rounds"',
    '  "show spending limits for trader"',
  ].join("\n"));
}

// ── Main ─────────────────────────────────────────────────────

export async function startChat(): Promise<void> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  let turnCount = 0;
  let processing = false;
  const queue: string[] = [];

  const ui = new TerminalUI();
  let resolveChat: (() => void) | null = null;

  async function processInput(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Commands
    if (/^(\/quit|\/exit|exit|quit|bye)$/i.test(trimmed)) {
      ui.stop();
      resolveChat?.();
      return;
    }
    if (/^(\/help|\?)$/i.test(trimmed)) { showHelp(ui); return; }
    if (/^\/clear$/i.test(trimmed)) {
      messages.length = 1; // keep system prompt
      turnCount = 0;
      ui.log("system", "Conversation cleared");
      return;
    }
    if (/^\/history$/i.test(trimmed)) {
      ui.log("system", `${turnCount} turns · ${messages.length} messages`);
      return;
    }

    turnCount++;
    ui.log("user", trimmed);
    messages.push({ role: "user", content: trimmed });
    ui.setBusy(true, "Working");
    ui.setActivity("Thinking...");

    try {
      const reply = await agentLoop(messages, ui);
      ui.setActivity(null);
      ui.log("assistant", reply);
    } catch (error) {
      ui.setActivity(null);
      const msg = error instanceof Error ? error.message : String(error);
      ui.log("error", msg);
      messages.pop(); // remove failed user message
    } finally {
      ui.setBusy(false, "Ready");
    }
  }

  async function drainQueue(): Promise<void> {
    if (processing) return;
    processing = true;
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) await processInput(next);
    }
    processing = false;
  }

  return new Promise<void>((resolve) => {
    resolveChat = resolve;

    ui.onSubmit((value) => {
      queue.push(value);
      drainQueue().catch((err) => {
        ui.log("error", err instanceof Error ? err.message : String(err));
        processing = false;
      });
    });

    ui.onExit(() => {
      ui.stop();
      resolveChat?.();
    });

    ui.start();
  });
}
