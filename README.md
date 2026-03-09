# Solana Agent Wallet

A Solana devnet wallet CLI built for AI agents. Create wallets, sign transactions automatically, hold SOL and SPL tokens, and run autonomous multi-agent flows — all from the command line.

## Install

```bash
npm install -g solana-agent-wallet
```

Or run from source:

```bash
git clone https://github.com/Nuel-osas/Blacksite.git
cd Blacksite
npm install --legacy-peer-deps
npm run build
```

## Quick Start

```bash
# Set a master key (encrypts all agent keypairs on disk)
export AGENT_WALLET_MASTER_KEY="pick-any-passphrase"

# Create agent wallets
agent-wallet agents:create treasury --role treasury
agent-wallet agents:create trader --role trader

# Fund from devnet faucet
agent-wallet airdrop treasury 2

# Transfer SOL
agent-wallet transfer:sol treasury trader 0.5

# Check balances
agent-wallet balances
```

## What It Does

| Feature | Command |
|---------|---------|
| Create wallets | `agents:create <name> --role <role>` |
| List wallets | `agents:list` |
| Devnet airdrop | `airdrop <agent> <amount>` |
| Transfer SOL | `transfer:sol <from> <to> <amount>` |
| Create SPL token | `token:create <alias> <authority> --decimals 6` |
| Mint tokens | `token:mint <alias> <authority> <recipient> <amount>` |
| Transfer tokens | `token:transfer <alias> <from> <to> <amount>` |
| Check balances | `balances [agent]` |
| Spending limits | `spending <agent>` |
| Wallet state | `state` |
| Bootstrap demo | `demo:bootstrap` |
| Run demo | `demo:run --rounds 2` |
| AI autonomous | `ai:run --rounds 3` |
| Natural language | `intent "send 1 sol from treasury to trader"` |
| AI chat | `chat` (or run with no args) |

## How AI Agents Use It

Any AI with shell access (Claude Code, GPT with code interpreter, a Python script, etc.) just runs CLI commands:

```bash
# AI creates a wallet
agent-wallet agents:create my-bot --role trader

# AI funds itself
agent-wallet airdrop my-bot 2

# AI sends SOL
agent-wallet transfer:sol my-bot treasury 0.5

# AI checks its balance
agent-wallet balances my-bot
```

All commands return **JSON to stdout** so agents can parse results:

```json
{
  "from": "my-bot",
  "to": "treasury",
  "amountSol": "0.5",
  "signature": "5Uj3..."
}
```

Read `SKILLS.md` for the full command reference that AI agents can consume.

## Architecture

```
CLI (index.ts)
  |
  ├── keystore.ts    AES-256-GCM encrypted keypairs (scrypt KDF)
  ├── solana.ts      Solana devnet RPC + signing
  ├── runtime.ts     Multi-agent demo simulation
  ├── autonomous.ts  AI-driven autonomous rounds
  ├── spending-policy.ts  Role-based spend limits
  ├── ai-engine.ts   LLM decision engine (OpenRouter)
  ├── intents.ts     Regex intent parser (offline)
  ├── chat.ts        Full-screen AI chat TUI
  └── voice.ts       Voice commands (Groq Whisper)
```

### Key Security

- Keypairs are **never stored in plaintext**
- AES-256-GCM encryption with scrypt key derivation
- Per-agent salt, IV, and auth tag
- Master key comes from `AGENT_WALLET_MASTER_KEY` env var
- Keys stored under `.agent-wallet/agents/` (gitignored)

### Spending Policy

Each agent role has enforced limits:

| Role | Per-tx | Hourly | Confirm above |
|------|--------|--------|---------------|
| treasury | 5 SOL | 20 SOL | 3 SOL |
| trader | 2 SOL | 10 SOL | 1 SOL |
| observer | 0.5 SOL | 2 SOL | 0.25 SOL |
| operator | 1 SOL | 5 SOL | 0.5 SOL |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_WALLET_MASTER_KEY` | Yes | Passphrase for encrypting keypairs |
| `SOLANA_RPC_URL` | No | Custom devnet RPC (defaults to `api.devnet.solana.com`) |
| `OPENROUTER_API_KEY` | For AI chat/autonomous | OpenRouter API key |
| `GROQ_API_KEY` | For voice | Groq API key for Whisper transcription |

## Demo Walkthrough

```bash
# 1. Bootstrap three demo agents
agent-wallet demo:bootstrap

# 2. Fund treasury from devnet faucet
agent-wallet airdrop treasury 2

# 3. Run scripted simulation (SOL transfers + token minting + settlement)
agent-wallet demo:run --rounds 2

# 4. Check final state
agent-wallet balances
agent-wallet state
```

## AI Autonomous Mode

With `OPENROUTER_API_KEY` set, each agent uses an LLM to decide actions:

```bash
agent-wallet ai:run --rounds 3
```

Each round, every agent:
1. Sees all balances and peer state
2. LLM decides: transfer, airdrop, mint, or hold
3. Spending policy enforced before signing
4. Transaction signed and submitted

## Interactive Chat

```bash
agent-wallet
```

Opens a full-screen TUI. Talk naturally:
- "bootstrap the demo"
- "airdrop 2 SOL to treasury"
- "send 0.5 SOL from treasury to trader"
- "create token USDC with treasury"
- "show balances"

## Development

```bash
npm run dev          # Run from TypeScript directly
npm run build        # Compile to dist/
npm run check        # Type-check without emitting
```

## License

MIT
