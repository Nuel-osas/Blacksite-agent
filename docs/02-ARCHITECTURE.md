# Architecture & File Map

## Directory Structure

```
prototype AI agent wallet/
├── src/
│   ├── index.ts              # CLI entrypoint (Commander.js, all subcommands)
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── config.ts             # Paths, constants, RPC URL
│   ├── keystore.ts           # AES-256-GCM encrypted key storage
│   ├── solana.ts             # Solana RPC: transfers, mints, airdrops
│   ├── runtime.ts            # Multi-agent demo simulation loop
│   ├── ai-engine.ts          # Groq LLM for autonomous decisions
│   ├── autonomous.ts         # AI autonomous execution loop
│   ├── spending-policy.ts    # Per-role spending limits
│   ├── voice.ts              # Microphone recording + Whisper transcription
│   ├── intents.ts            # Regex-based intent parser (offline fallback)
│   ├── assistant.ts          # Conversational intent handler
│   ├── chat.ts               # AI chat interface (Groq tool-calling + Auraai UI)
│   └── tui.ts                # Terminal UI dashboard
├── dist/                     # Compiled JS output
├── .agent-wallet/            # Runtime storage (gitignored)
│   ├── agents/               # Encrypted keypair JSON per agent
│   ├── master.key            # Auto-generated encryption key
│   └── state.json            # Tracked SPL token mints
├── docs/                     # Documentation
├── package.json
├── tsconfig.json
├── .env                      # API keys (gitignored)
└── .gitignore
```

## Six-Layer Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Layer 6: User Interfaces                                │
│  chat.ts (AI chat) · tui.ts (dashboard) · voice.ts      │
├──────────────────────────────────────────────────────────┤
│  Layer 5: AI / Decision Engine                           │
│  ai-engine.ts (Groq LLM) · autonomous.ts (execution)    │
├──────────────────────────────────────────────────────────┤
│  Layer 4: Intent Parsing                                 │
│  intents.ts (regex) · assistant.ts (conversational)      │
├──────────────────────────────────────────────────────────┤
│  Layer 3: Policy & Limits                                │
│  spending-policy.ts (per-role enforcement)                │
├──────────────────────────────────────────────────────────┤
│  Layer 2: Runtime / Orchestration                        │
│  runtime.ts (simulation loop, bootstrap, balance queries)│
├──────────────────────────────────────────────────────────┤
│  Layer 1: Core Infrastructure                            │
│  keystore.ts (encryption) · solana.ts (RPC) · config.ts  │
└──────────────────────────────────────────────────────────┘
```

## File-by-File Breakdown

### `src/config.ts` — Configuration Constants
- `STORE_DIR`: `.agent-wallet` directory path
- `AGENTS_DIR`: Per-agent encrypted JSON files
- `STATE_FILE`: Persistent wallet state (tracked mints)
- `DEFAULT_RPC_URL`: Solana devnet RPC endpoint
- `MEMO_PROGRAM_ID`: On-chain memo program for audit trails
- `ensureStoreLayout()`: Creates directories at startup

### `src/types.ts` — Type Definitions
All shared interfaces:
- `AgentRecord`: name, role, publicKey, encryptedSecretKey, salt, iv, authTag, createdAt
- `MintRecord`: alias, address, decimals, authorityAgent, createdAt
- `WalletState`: dictionary of tracked mints
- `BalanceSnapshot`: agent balances (SOL + tokens)
- `SimulationStep` / `SimulationResult`: demo round tracking
- `BootstrapResult`: airdrop attempt results
- `ParsedIntent`: discriminated union of 15 intent variants

### `src/keystore.ts` — Encrypted Key Storage (205 lines)
The security core:
- `getMasterKey()`: env var → file → auto-generate
- `deriveKey(masterKey, salt)`: scrypt KDF → 32-byte AES key
- `encryptSecretKey(secretKey)`: AES-256-GCM with random salt + IV
- `decryptSecretKey(record)`: reverse decryption for signing
- `createAgent(name, role)`: generate Keypair, encrypt, write to disk
- `loadAgentKeypair(name)`: read + decrypt → `{ record, keypair }`
- `listAgents()`: enumerate all agent files
- `loadState()` / `saveState()`: persist mint tracking
- File permissions: 0o600 (owner read/write only)

### `src/solana.ts` — Solana RPC Adapter (199 lines)
All blockchain interactions:
- **SOL**: `requestAirdrop()`, `getSolBalance()`, `transferSol()`
- **SPL Tokens**: `createTokenMint()`, `mintTokens()`, `transferTokens()`, `getTokenBalance()`
- **Helpers**: `ensureAssociatedTokenAccount()`, `parseTokenAmount()`, `formatTokenAmount()`, `parseSol()`
- **Memos**: `memoInstruction()` for on-chain audit trails
- All transactions use "confirmed" commitment level

### `src/runtime.ts` — Multi-Agent Simulation (210 lines)
Scripted demo loop:
- `bootstrapDemoAgents(airdropSol)`: create treasury/trader/observer + fund them
- `describeBalances(agent?)`: query SOL + token balances for all/one agent
- `runDemoSimulation(rounds)`: each round does:
  1. Treasury tops up trader/observer SOL if low
  2. Treasury mints 25 SANDBOX tokens to trader
  3. Trader transfers 10 SANDBOX to observer
  4. Observer sends 0.01 SOL back to treasury

### `src/ai-engine.ts` — AI Decision Engine (134 lines)
Groq-powered autonomous decisions:
- `getAgentDecision()`: builds context prompt with balances + limits → Groq → JSON decision
- `parseVoiceIntent()`: speech transcript → structured wallet action
- Model: `llama-3.3-70b-versatile`
- Actions: transfer_sol, transfer_token, airdrop, mint_tokens, hold, check_balance

### `src/autonomous.ts` — AI Execution Loop (147 lines)
Executes AI decisions with safety:
- `executeDecision()`: match action → check spending policy → sign transaction
- `runAutonomousRound()`: all agents get AI decisions, execute sequentially
- `runAutonomousLoop(rounds)`: multiple rounds with delay between

### `src/spending-policy.ts` — Spending Limits (77 lines)
Role-based enforcement:

| Role | Max/tx | Max/hour | Confirm above |
|------|--------|----------|---------------|
| treasury | 5 SOL | 20 SOL | 3 SOL |
| trader | 2 SOL | 10 SOL | 1 SOL |
| observer | 0.5 SOL | 2 SOL | 0.25 SOL |
| operator | 1 SOL | 5 SOL | 0.5 SOL |

- `checkSpendingPolicy()`: validates against limits
- `recordSpend()`: tracks in-memory with timestamps
- `getSpendingSummary()`: current usage vs limits

### `src/voice.ts` — Voice Pipeline (79 lines)
Speech-to-action:
- `recordAudio()`: spawn `rec` (macOS) or `arecord` (Linux) → WAV file
- `transcribeAudio()`: Groq Whisper API (whisper-large-v3)
- `listenAndTranscribe()`: record + transcribe + cleanup
- `startVoiceLoop()`: continuous listen → transcribe → execute loop

### `src/intents.ts` — Regex Intent Parser (121 lines)
Offline fallback for natural language:
- 15 intent types with flexible regex patterns
- Examples: "airdrop 1 sol to trader", "send 0.5 from treasury to trader", "bootstrap the demo"
- Returns typed `ParsedIntent` union

### `src/assistant.ts` — Conversational Handler (485 lines)
Bridges text → intent → execution:
- `handleSlashCommand()`: /help, /wallets, /fund, /bootstrap, /balances, /airdrop, /demo, /ai, /spending, /state
- `handleConversation()`: greeting detection, help patterns, balance queries, fallback to intent parser
- `runIntent()`: execute any parsed intent

### `src/chat.ts` — AI Chat Interface (484 lines)
The main interface — Groq tool-calling with Auraai-styled terminal UI:
- **15 tools** registered with Groq for function calling
- **Agentic loop**: send message → LLM returns tool_calls → execute → send results → repeat until done
- **UI**: welcome banner, user bubbles (right-aligned blue), tool chips (colored dots), streaming text output, spinners
- **Color system**: heat (orange), amethyst (purple), bluetron (blue), forest (green), honey (yellow), crimson (red)
- Supports sending to both agent names AND external Solana public keys

### `src/tui.ts` — Terminal UI Dashboard (147 lines)
Dashboard view with:
- Agent list, balances, activity log
- Slash command + natural language input
- ANSI-colored layout

### `src/index.ts` — CLI Entrypoint (410 lines)
Commander.js with all subcommands:
- agents:create, agents:list, balances, airdrop, transfer:sol
- token:create, token:mint, token:transfer
- demo:bootstrap, demo:run, demo:all
- ai:run, voice, spending, state, chat, tui, intent
- Default (no args) → starts chat interface

## Data Flow: AI Chat

```
User types: "send 0.1 SOL from treasury to AfWin6..."
                    │
                    ▼
        ┌─── chat.ts ───┐
        │ readline input │
        │ → messages[]   │
        └───────┬────────┘
                │
                ▼
        ┌─── Groq API ──┐
        │ system prompt  │
        │ + tools[]      │
        │ + messages[]   │
        └───────┬────────┘
                │ finish_reason: "tool_calls"
                │ tool: transfer_sol_to_address
                ▼
        ┌─── executeTool ┐
        │ loadKeypair()  │
        │ new PublicKey() │
        │ transferSol()  │
        └───────┬────────┘
                │ signature
                ▼
        ┌─── Groq API ──┐
        │ tool result    │
        │ → final text   │
        └───────┬────────┘
                │ finish_reason: "stop"
                ▼
        streamText() → character-by-character output
```

## Data Flow: Autonomous Mode

```
runAutonomousLoop(rounds=3)
        │
        ▼ for each round
        │
        ▼ for each agent
┌─── ai-engine.ts ──┐
│ buildAgentContext() │  balances + limits + peers
│ groq.chat.create() │  → JSON decision
└───────┬────────────┘
        │ AgentDecision
        ▼
┌─── autonomous.ts ──┐
│ checkSpendingPolicy │
│ executeDecision()   │  sign + send tx
│ recordSpend()       │
└───────┬────────────┘
        │ result
        ▼
   console.log() + next agent
```
