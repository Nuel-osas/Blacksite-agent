import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { DEFAULT_RPC_URL, STORE_DIR } from "./config.js";
import { helpLines, handleConversation, handleSlashCommand } from "./assistant.js";
import { formatAgentRow, listAgents, loadState } from "./keystore.js";
import { getDemoPrerequisiteStatus } from "./runtime.js";

const RECENT_ACTIVITY_LIMIT = 8;
const PANEL_WIDTH = 96;

interface SessionActivity {
  timestamp: string;
  summary: string;
}

function clearScreen(): void {
  if (output.isTTY) {
    output.write("\x1Bc");
  }
}

function line(width = PANEL_WIDTH): string {
  return `+${"-".repeat(width - 2)}+`;
}

function pad(text: string, width = PANEL_WIDTH): string {
  const trimmed = text.length > width - 4 ? `${text.slice(0, width - 7)}...` : text;
  return `| ${trimmed.padEnd(width - 4)} |`;
}

function section(title: string, rows: string[]): string[] {
  return [line(), pad(title), line(), ...rows.map((row) => pad(row))];
}

function formatActivity(items: SessionActivity[]): string[] {
  if (items.length === 0) {
    return ["No actions yet."];
  }
  return items.slice(-RECENT_ACTIVITY_LIMIT).reverse().map((item) => `${item.timestamp}  ${item.summary}`);
}

function pushActivity(activity: SessionActivity[], summary: string): void {
  activity.push({
    timestamp: new Date().toISOString().slice(11, 19),
    summary,
  });
}

async function renderDashboard(activity: SessionActivity[], lastOutput: string[]): Promise<void> {
  const [agents, walletState] = await Promise.all([listAgents(), loadState()]);
  const treasuryRecord = agents.find((agent) => agent.name === "treasury");
  const treasuryStatus = await getDemoPrerequisiteStatus().catch(() => null);

  clearScreen();

  const headerRows = [
    "Wallet Shell",
    `Project: ${process.cwd()}`,
    `RPC: ${DEFAULT_RPC_URL}`,
    `Store: ${STORE_DIR}`,
    `Agents: ${agents.length}   Tracked mints: ${Object.keys(walletState.mints).length}`,
    treasuryRecord
        ? `Treasury: ${treasuryRecord.publicKey}   SOL: ${
          treasuryStatus ? treasuryStatus.treasurySol.toFixed(4) : "rpc unavailable"
        }`
      : "Treasury: not created yet",
    "Talk to the wallet or use slash commands.",
    "Try: give me the wallet to fund",
  ];

  const walletRows =
    agents.length === 0
      ? ["No agents created yet."]
      : ["name         role         publicKey", ...agents.map(formatAgentRow)];

  const rows = [
    ...section("Prototype AI Agent Wallet", headerRows),
    ...section("Wallets", walletRows),
    ...section("Recent Activity", formatActivity(activity)),
    ...section("Output", lastOutput.length === 0 ? ["Ready. Type /help or enter an intent."] : lastOutput),
    line(),
  ];

  output.write(`${rows.join("\n")}\n`);
}

export async function startTui(): Promise<void> {
  const rl = createInterface({ input, output });
  const activity: SessionActivity[] = [];
  let lastOutput = ["Ready. Talk to the wallet or type /help."];

  try {
    for (;;) {
      await renderDashboard(activity, lastOutput);
      let command = "";
      try {
        command = (await rl.question("wallet> ")).trim();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("readline was closed")) {
          break;
        }
        throw error;
      }

      if (!command) {
        continue;
      }

      try {
        if (command.startsWith("/")) {
          const result = await handleSlashCommand(command);
          if (result.clearActivity) {
            activity.length = 0;
          } else {
            pushActivity(activity, result.summary);
          }
          lastOutput = result.outputLines;
          if (result.shouldExit) {
            break;
          }
          continue;
        }

        const result = await handleConversation(command);
        if (result.clearActivity) {
          activity.length = 0;
        } else {
          pushActivity(activity, result.summary);
        }
        lastOutput = result.outputLines;
        if (result.shouldExit) {
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushActivity(activity, `Error: ${message}`);
        lastOutput = [`Error: ${message}`];
      }
    }
  } finally {
    rl.close();
    clearScreen();
  }
}
