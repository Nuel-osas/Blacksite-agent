# Prototype AI Agent Wallet

This repository is a Solana devnet prototype for the bounty in [gggg.md](/Users/emmanuelosadebe/Downloads/prototype AI agent wallet/gggg.md). It provides:

- Programmatic agent wallet creation with encrypted local key storage
- Automatic transaction signing for SOL and SPL token flows
- A sandboxed multi-agent runtime on Solana devnet
- A wallet shell on `npm run cli` with slash commands and plain-English intents
- **AI-powered autonomous mode** — Claude decides what each agent should do each round
- **Speech-to-action voice commands** — speak into your mic, Whisper transcribes, Claude parses the intent, wallet executes
- **Spending policies** — per-role transaction and hourly limits enforced before every transaction
- Documentation covering security, architecture, and demo steps

## Architecture

```
Voice (mic) ──> Whisper ──> Claude Intent Parser ──┐
                                                    ├──> Action Router ──> Solana Devnet
CLI / TUI (commands + natural language) ───────────┘

AgentOrchestrator
  ├── treasury  ──> Wallet A (AES-256-GCM encrypted)
  ├── trader    ──> Wallet B (AES-256-GCM encrypted)
  └── observer  ──> Wallet C (AES-256-GCM encrypted)
```

- `src/keystore.ts`: encrypted per-agent key storage using AES-256-GCM
- `src/solana.ts`: Solana devnet RPC adapter, SOL transfers, SPL minting, token transfers, memo support
- `src/runtime.ts`: scripted multi-agent simulation loop
- `src/ai-engine.ts`: Claude-powered autonomous decision engine + voice intent parser
- `src/voice.ts`: microphone capture via SoX + OpenAI Whisper transcription
- `src/autonomous.ts`: AI autonomous loop — each agent thinks and acts independently
- `src/spending-policy.ts`: per-role spending limits enforced before signing
- `src/assistant.ts`: conversational TUI handler for natural-language interaction
- `src/intents.ts`: regex-based intent parser (fallback for offline use)
- `src/index.ts`: CLI entrypoint

## Requirements

- Node.js 20+

No manual setup is required for local key encryption. On first run, the CLI will generate a local master key at `.agent-wallet/master.key` and use it to encrypt agent wallets.

Optional override:

```bash
export AGENT_WALLET_MASTER_KEY="replace-this-with-a-long-random-passphrase"
```

For AI autonomous mode and voice commands, also set:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # Required for ai:run and voice intent parsing
export OPENAI_API_KEY="sk-..."          # Required for voice transcription (Whisper)
export SOLANA_RPC_URL="https://api.devnet.solana.com"  # Optional
```

For voice commands, install SoX: `brew install sox` (macOS) or `apt install sox` (Linux).

## Install

```bash
npm install
npm run build
```

## Start

Launch the wallet shell:

```bash
npm run cli
```

Examples inside the shell:

```text
/help
/wallets
/fund
/bootstrap 0.2
/balances
/demo 2
give me the wallet to fund
show balances
run the demo
transfer 0.2 sol from treasury to trader
```

You can still run direct subcommands when you want scriptable behavior:

```bash
npm run cli -- balances
```

## Core commands

Create an agent wallet:

```bash
npm run cli -- agents:create treasury --role treasury
```

List agents:

```bash
npm run cli -- agents:list
```

Request devnet SOL:

```bash
npm run cli -- airdrop treasury 1
```

Create a tracked SPL mint:

```bash
npm run cli -- token:create sandbox treasury --decimals 6
```

Mint to an agent:

```bash
npm run cli -- token:mint sandbox treasury trader 25 --memo "seed inventory"
```

Transfer SOL automatically:

```bash
npm run cli -- transfer:sol treasury trader 0.2 --memo "fee top-up"
```

Transfer SPL tokens automatically:

```bash
npm run cli -- token:transfer sandbox trader observer 10 --memo "sandbox rebalance"
```

Inspect balances:

```bash
npm run cli -- balances
```

## Demo flow

Bootstrap three default agents and request devnet SOL:

```bash
npm run cli -- demo:bootstrap --airdrop 1
```

Run the autonomous simulation:

```bash
npm run cli -- demo:run --rounds 2
```

Or do both in one shot:

```bash
npm run cli -- demo:all --airdrop 1 --rounds 2
```

The demo creates or reuses:

- `treasury`: fee sponsor and mint authority
- `trader`: receives freshly minted SANDBOX inventory
- `observer`: receives rebalanced SANDBOX tokens and settles SOL back to treasury

Each round automatically:

1. Tops up low-balance agents with SOL.
2. Mints SANDBOX SPL tokens from the treasury agent.
3. Transfers SANDBOX tokens from trader to observer.
4. Sends a small SOL settlement back to treasury.
5. Attaches memos so autonomous decisions are easy to audit on-chain.

This covers:

- Programmatic wallet creation
- Automated signing
- SOL and SPL custody
- Protocol interaction through the SPL Token Program and Memo Program
- Multi-agent independence

## Devnet note

Devnet airdrops are sometimes rate-limited or temporarily unavailable. The bootstrap command now reports per-agent success or failure instead of aborting on the first airdrop error. If airdrops fail during judging, rerun the command or point `SOLANA_RPC_URL` at a different devnet RPC provider.

## AI Autonomous Mode

Let Claude make decisions for each agent. Requires `ANTHROPIC_API_KEY` in `.env`:

```bash
# Run 3 rounds of AI-driven autonomous agent actions
npm run cli -- ai:run --rounds 3

# From the TUI shell:
/ai 3
```

Each round, every agent:
1. Sees its own balances, spending limits, and other agents' state
2. Claude decides the best action (transfer, airdrop, mint, hold, etc.)
3. Spending policy enforces limits before signing
4. Transaction executes on devnet

## Voice Commands

Speak wallet actions into your microphone. Requires `OPENAI_API_KEY` in `.env` and SoX installed (`brew install sox`):

```bash
npm run cli -- voice --duration 5
```

Say things like:
- "Send half a SOL from treasury to trader"
- "Airdrop 2 SOL to observer"
- "Check the balances"
- "exit" to stop

The pipeline: Mic → SoX recording → Whisper transcription → Claude intent parsing → wallet execution.

## Spending Policies

Each agent role has enforced spending limits:

```bash
npm run cli -- spending treasury
```

| Role | Max per tx | Max per hour | Confirm above |
|------|-----------|-------------|---------------|
| treasury | 5 SOL | 20 SOL | 3 SOL |
| trader | 2 SOL | 10 SOL | 1 SOL |
| observer | 0.5 SOL | 2 SOL | 0.25 SOL |
| operator | 1 SOL | 5 SOL | 0.5 SOL |

## Intent interface

The same CLI can accept natural-language text that a speech recognizer could forward directly:

```bash
npm run cli -- intent "airdrop 1 sol to trader"
npm run cli -- intent "transfer 0.2 sol from treasury to trader"
npm run cli -- intent "run 2 demo rounds"
```

## Files written at runtime

- `.agent-wallet/master.key`: auto-generated local encryption key unless `AGENT_WALLET_MASTER_KEY` is set
- `.agent-wallet/agents/*.json`: encrypted per-agent key material plus public metadata
- `.agent-wallet/state.json`: tracked mint aliases

## Security notes

- Private keys are never stored in plaintext on disk.
- By default, the CLI auto-generates a local master key and stores it in `.agent-wallet/master.key`.
- If `AGENT_WALLET_MASTER_KEY` is set, it overrides the local master key file.
- The encryption key is derived with `scrypt`.
- Each agent uses a separate keystore file, which makes multi-agent isolation simpler.
- The current prototype assumes a trusted local operator environment and does not use HSMs, MPC, or remote signers.

See [deep-dive.md](/Users/emmanuelosadebe/Downloads/prototype AI agent wallet/docs/deep-dive.md) for the design walkthrough and extension ideas.
