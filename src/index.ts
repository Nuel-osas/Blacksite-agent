#!/usr/bin/env node
import "dotenv/config";

import { Command } from "commander";

import { APP_NAME, DEFAULT_RPC_URL } from "./config.js";
import { createAgent, formatAgentRow, getMintRecord, listAgents, loadAgentKeypair, loadState, upsertMintRecord } from "./keystore.js";
import { parseIntent } from "./intents.js";
import { bootstrapDemoAgents, describeBalances, runDemoSimulation } from "./runtime.js";
import { createTokenMint, mintTokens, parseSol, requestAirdrop, transferSol, transferTokens } from "./solana.js";
import { startTui } from "./tui.js";
import { startChat } from "./chat.js";
import { runAutonomousLoop } from "./autonomous.js";
import { parseVoiceIntent } from "./ai-engine.js";
import { startVoiceLoop } from "./voice.js";
import { getSpendingSummary } from "./spending-policy.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function formatBalances(snapshot: Awaited<ReturnType<typeof describeBalances>>): string {
  return snapshot
    .map((item) => {
      const tokens = item.tokens.length
        ? item.tokens.map((token) => `${token.alias}:${token.balance}`).join(", ")
        : "none";
      return `${item.agent.padEnd(12)} SOL=${item.sol.toFixed(4).padEnd(10)} tokens=${tokens}`;
    })
    .join("\n");
}

const program = new Command();

program
  .name(APP_NAME)
  .description("Solana devnet agentic wallet CLI for autonomous multi-agent flows.")
  .version("0.1.0");

program
  .command("agents:create")
  .argument("<name>", "agent name")
  .option("--role <role>", "agent role", "operator")
  .action(async (name, options: { role: string }) => {
    const record = await createAgent(name, options.role);
    printJson(record);
  });

program.command("agents:list").action(async () => {
  const agents = await listAgents();
  if (agents.length === 0) {
    console.log("No agents have been created yet.");
    return;
  }
  console.log("name         role         publicKey");
  console.log(agents.map(formatAgentRow).join("\n"));
});

program
  .command("balances")
  .argument("[agent]", "optional agent name")
  .action(async (agent?: string) => {
    const snapshot = await describeBalances(agent);
    if (snapshot.length === 0) {
      console.log("No matching agents were found.");
      return;
    }
    console.log(formatBalances(snapshot));
  });

program
  .command("airdrop")
  .argument("<agent>", "agent name")
  .argument("<amountSol>", "amount of SOL to request")
  .action(async (agent: string, amountSol: string) => {
    const { keypair } = await loadAgentKeypair(agent);
    const signature = await requestAirdrop(keypair.publicKey, parseSol(amountSol));
    printJson({ agent, amountSol, signature, rpcUrl: DEFAULT_RPC_URL });
  });

program
  .command("transfer:sol")
  .argument("<from>", "sender agent")
  .argument("<to>", "recipient agent")
  .argument("<amountSol>", "amount of SOL")
  .option("--memo <memo>", "memo to attach")
  .action(async (from: string, to: string, amountSol: string, options: { memo?: string }) => {
    const sender = await loadAgentKeypair(from);
    const recipient = await loadAgentKeypair(to);
    const signature = await transferSol(
      sender.keypair,
      recipient.keypair.publicKey,
      parseSol(amountSol),
      options.memo,
    );
    printJson({ from, to, amountSol, signature });
  });

program
  .command("token:create")
  .argument("<alias>", "tracked mint alias")
  .argument("<authorityAgent>", "mint authority agent")
  .option("--decimals <decimals>", "mint decimals", "6")
  .action(async (alias: string, authorityAgent: string, options: { decimals: string }) => {
    const authority = await loadAgentKeypair(authorityAgent);
    const decimals = Number(options.decimals);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
      throw new Error("Token decimals must be an integer between 0 and 9.");
    }
    const address = await createTokenMint(authority.keypair, decimals);
    await upsertMintRecord({
      alias,
      address,
      decimals,
      authorityAgent,
      createdAt: new Date().toISOString(),
    });
    printJson({ alias, address, authorityAgent, decimals });
  });

program
  .command("token:mint")
  .argument("<alias>", "tracked mint alias")
  .argument("<authorityAgent>", "mint authority agent")
  .argument("<recipientAgent>", "recipient agent")
  .argument("<amount>", "human-readable token amount")
  .option("--memo <memo>", "memo to attach")
  .action(async (alias: string, authorityAgent: string, recipientAgent: string, amount: string, options: { memo?: string }) => {
    const mint = await getMintRecord(alias);
    if (!mint) {
      throw new Error(`Mint alias "${alias}" was not found.`);
    }
    const authority = await loadAgentKeypair(authorityAgent);
    const recipient = await loadAgentKeypair(recipientAgent);
    const signature = await mintTokens(
      authority.keypair,
      mint.address,
      recipient.keypair.publicKey,
      amount,
      options.memo,
    );
    printJson({ alias, amount, authorityAgent, recipientAgent, signature });
  });

program
  .command("token:transfer")
  .argument("<alias>", "tracked mint alias")
  .argument("<from>", "sender agent")
  .argument("<to>", "recipient agent")
  .argument("<amount>", "human-readable token amount")
  .option("--memo <memo>", "memo to attach")
  .action(async (alias: string, from: string, to: string, amount: string, options: { memo?: string }) => {
    const mint = await getMintRecord(alias);
    if (!mint) {
      throw new Error(`Mint alias "${alias}" was not found.`);
    }
    const sender = await loadAgentKeypair(from);
    const recipient = await loadAgentKeypair(to);
    const signature = await transferTokens(
      sender.keypair,
      mint.address,
      recipient.keypair.publicKey,
      amount,
      options.memo,
    );
    printJson({ alias, amount, from, to, signature });
  });

program
  .command("demo:bootstrap")
  .option("--airdrop <amount>", "SOL airdrop per default agent", "1")
  .action(async (options: { airdrop: string }) => {
    const results = await bootstrapDemoAgents();
    printJson({ agents: ["treasury", "trader", "observer"], results });
  });

program
  .command("demo:run")
  .option("--rounds <rounds>", "number of autonomous rounds", "2")
  .action(async (options: { rounds: string }) => {
    const result = await runDemoSimulation(Number(options.rounds));
    printJson(result);
  });

program
  .command("demo:all")
  .option("--airdrop <amount>", "SOL airdrop per default agent", "1")
  .option("--rounds <rounds>", "number of autonomous rounds", "2")
  .action(async (options: { airdrop: string; rounds: string }) => {
    const results = await bootstrapDemoAgents();
    const result = await runDemoSimulation(Number(options.rounds));
    printJson({
      bootstrap: results,
      result,
    });
  });

program
  .command("intent")
  .argument("<text>", "natural-language command text")
  .action(async (text: string) => {
    const intent = parseIntent(text);
    switch (intent.kind) {
      case "airdrop": {
        const { keypair } = await loadAgentKeypair(intent.agent);
        const signature = await requestAirdrop(keypair.publicKey, parseSol(intent.amountSol));
        printJson({ intent, signature });
        return;
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
        printJson({ intent, signature });
        return;
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
        printJson({ intent, address });
        return;
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
        printJson({ intent, signature });
        return;
      }
      case "simulate": {
        printJson(await runDemoSimulation(intent.rounds));
        return;
      }
      case "transfer-token": {
        const mint = await getMintRecord(intent.alias);
        if (!mint) throw new Error(`Mint alias "${intent.alias}" was not found.`);
        const sender = await loadAgentKeypair(intent.from);
        const recipient = await loadAgentKeypair(intent.to);
        const signature = await transferTokens(sender.keypair, mint.address, recipient.keypair.publicKey, intent.amount);
        printJson({ intent, signature });
        return;
      }
      case "create-agent": {
        const record = await createAgent(intent.name, intent.role);
        printJson(record);
        return;
      }
      case "list-agents": {
        const agents = await listAgents();
        console.log(agents.map(formatAgentRow).join("\n"));
        return;
      }
      case "balances": {
        const snapshot = await describeBalances(intent.agent);
        printJson(snapshot);
        return;
      }
      case "bootstrap": {
        const results = await bootstrapDemoAgents();
        printJson(results);
        return;
      }
      case "autonomous": {
        const result = await runAutonomousLoop(Number(intent.rounds));
        printJson(result);
        return;
      }
      case "spending": {
        const { record } = await loadAgentKeypair(intent.agent);
        printJson(getSpendingSummary(record.name, record.role));
        return;
      }
      case "state": {
        printJson(await loadState());
        return;
      }
      default: {
        const unreachable: never = intent;
        throw new Error(`Unhandled intent: ${JSON.stringify(unreachable)}`);
      }
    }
  });

program
  .command("ai:run")
  .description("Run AI-powered autonomous agent rounds (requires ANTHROPIC_API_KEY)")
  .option("--rounds <rounds>", "number of autonomous rounds", "2")
  .option("--delay <ms>", "delay between rounds in ms", "3000")
  .action(async (options: { rounds: string; delay: string }) => {
    const result = await runAutonomousLoop(Number(options.rounds), Number(options.delay));
    printJson(result);
  });

program
  .command("voice")
  .description("Start voice command mode (requires OPENAI_API_KEY + SoX)")
  .option("--duration <seconds>", "listening duration per command", "5")
  .action(async (options: { duration: string }) => {
    const agents = await listAgents();
    const agentNames = agents.map((a) => a.name);

    await startVoiceLoop(async (transcript) => {
      try {
        const decision = await parseVoiceIntent(transcript, agentNames);
        console.log(`  Action: ${decision.action} -- ${decision.reasoning}`);
        console.log(`  Params: ${JSON.stringify(decision.params)}`);

        switch (decision.action) {
          case "airdrop": {
            const agent = decision.params.agent ?? agentNames[0];
            const { keypair } = await loadAgentKeypair(agent);
            const sig = await requestAirdrop(keypair.publicKey, parseSol(decision.params.amount ?? "1"));
            console.log(`  Done. Signature: ${sig}`);
            break;
          }
          case "transfer_sol": {
            const sender = await loadAgentKeypair(decision.params.from);
            const recipient = await loadAgentKeypair(decision.params.to);
            const sig = await transferSol(
              sender.keypair, recipient.keypair.publicKey,
              parseSol(decision.params.amount), "voice-transfer",
            );
            console.log(`  Done. Signature: ${sig}`);
            break;
          }
          case "check_balance": {
            const snapshot = await describeBalances(decision.params.agent);
            console.log(formatBalances(snapshot));
            break;
          }
          default:
            console.log(`  Action "${decision.action}" noted.`);
        }
      } catch (err) {
        console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, { duration: Number(options.duration) });
  });

program
  .command("spending")
  .argument("<agent>", "agent name")
  .description("Show spending policy and limits for an agent")
  .action(async (agentName: string) => {
    const { record } = await loadAgentKeypair(agentName);
    const summary = getSpendingSummary(record.name, record.role);
    printJson({
      agent: record.name,
      role: record.role,
      ...summary,
    });
  });

program
  .command("chat")
  .description("Start the AI chat interface (Claude-powered, like talking to an assistant)")
  .action(async () => {
    await startChat();
  });

program
  .command("tui")
  .description("Start the dashboard TUI with slash commands")
  .action(async () => {
    await startTui();
  });

program.command("state").action(async () => {
  printJson(await loadState());
});

if (process.argv.length <= 2) {
  startChat().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("readline was closed")) {
      process.exitCode = 0;
      return;
    }
    console.error(message);
    process.exitCode = 1;
  });
} else {
  program.parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
