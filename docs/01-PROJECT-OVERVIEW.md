# Project Overview: AI Agent Wallet for Solana

## What Is This?

A **Solana devnet prototype** where AI agents autonomously create wallets, sign transactions, hold funds, and interact with on-chain protocols — all without manual intervention. Built for a **$5,000 Solana bounty** focused on agentic wallet infrastructure.

## The Core Idea

Instead of humans clicking buttons to send crypto, **AI agents get their own wallets** and make financial decisions independently. A treasury agent manages funds, a trader agent moves tokens, an observer agent settles payments — all coordinated by an LLM (Llama 3.3 via Groq) that sees balances, spending limits, and peer state before deciding what to do.

## What Makes It Special

1. **True autonomous signing** — Agents hold encrypted private keys and sign transactions without human approval
2. **Spending policy enforcement** — Per-role limits prevent any single agent from draining funds
3. **Multi-agent coordination** — Treasury, trader, and observer work together in structured rounds
4. **Natural language control** — Talk to your wallet in plain English via chat or voice
5. **AI tool-calling loop** — Groq's function calling lets the LLM invoke 15 blockchain tools autonomously
6. **Secure local custody** — AES-256-GCM encryption with scrypt KDF, keys never stored in plaintext

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Solana devnet (web3.js + spl-token) |
| AI / LLM | Groq API — Llama 3.3-70b-versatile |
| Voice | Groq Whisper (whisper-large-v3) |
| Encryption | AES-256-GCM + scrypt (Node.js crypto) |
| CLI | Commander.js |
| Chat UI | readline + ANSI 256-color (Auraai-style) |
| Language | TypeScript (strict mode, ES2022) |
| Runtime | Node.js >= 20 |

## Repository

- **GitHub**: https://github.com/Nuel-osas/Blacksite.git
- **Local**: `prototype AI agent wallet/`
- **14 source files**, ~2,500 lines of TypeScript

## How It Works (High Level)

```
User speaks/types
       │
       ▼
┌─────────────────┐
│  Chat Interface  │  readline + Auraai colors
│  (chat.ts)       │  character-streaming output
└────────┬────────┘
         │ user message
         ▼
┌─────────────────┐
│  Groq LLM       │  llama-3.3-70b-versatile
│  Tool Calling    │  15 registered tools
└────────┬────────┘
         │ tool_calls
         ▼
┌─────────────────┐
│  Tool Executor   │  executeTool() dispatch
│  (chat.ts)       │  loads keys, calls Solana
└────────┬────────┘
         │ tool results
         ▼
┌─────────────────┐
│  Solana Devnet   │  SOL transfers, SPL tokens,
│  (solana.ts)     │  mints, airdrops, memos
└─────────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the chat (default command)
npm run cli

# Or run the full demo in one shot
npm run cli -- demo:all --airdrop 1 --rounds 2
```

## Environment Variables

```env
GROQ_API_KEY=gsk_...              # Required — free tier, no card needed
SOLANA_RPC_URL=https://api.devnet.solana.com  # Optional, defaults to devnet
AGENT_WALLET_MASTER_KEY=...       # Optional — auto-generated if missing
```
