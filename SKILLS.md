# Agent Wallet — Skills

You are interacting with a Solana devnet agent wallet CLI. Use `agent-wallet` after global install, or `npx solana-agent-wallet`, or `node dist/index.js` from source.

All operations happen on **Solana devnet** — no real funds at risk.

## Setup

```bash
npm install -g solana-agent-wallet
export AGENT_WALLET_MASTER_KEY="any-passphrase-you-choose"
```

## Commands

### Create an agent wallet
```bash
agent-wallet agents:create <name> --role <role>
```
Roles: `treasury`, `trader`, `observer`, `operator` (default). Each role has different spending limits.

### List all agents
```bash
agent-wallet agents:list
```

### Fund an agent (devnet airdrop)
```bash
agent-wallet airdrop <agent> <amount>
```

### Transfer SOL between agents
```bash
agent-wallet transfer:sol <from> <to> <amount>
```

### Check balances
```bash
agent-wallet balances [agent]
```

### Create an SPL token
```bash
agent-wallet token:create <alias> <authority-agent> --decimals <n>
```

### Mint tokens
```bash
agent-wallet token:mint <alias> <authority-agent> <recipient-agent> <amount>
```

### Transfer tokens
```bash
agent-wallet token:transfer <alias> <from> <to> <amount>
```

### View spending limits
```bash
agent-wallet spending <agent>
```

### View wallet state (tracked mints)
```bash
agent-wallet state
```

### Bootstrap demo agents (treasury, trader, observer)
```bash
agent-wallet demo:bootstrap
```

### Run scripted demo simulation
Treasury must be funded first.
```bash
agent-wallet airdrop treasury 2
agent-wallet demo:run --rounds 2
```

### Run AI autonomous rounds
Requires `OPENROUTER_API_KEY` env var.
```bash
agent-wallet ai:run --rounds 3
```

### Natural language intent
```bash
agent-wallet intent "send 0.5 sol from treasury to trader"
```

### Interactive AI chat
```bash
agent-wallet chat
```
Or just run with no arguments: `agent-wallet`

## Spending Limits by Role

| Role     | Per-tx max | Hourly max | Confirm above |
|----------|-----------|------------|---------------|
| treasury | 5 SOL     | 20 SOL     | 3 SOL         |
| trader   | 2 SOL     | 10 SOL     | 1 SOL         |
| observer | 0.5 SOL   | 2 SOL      | 0.25 SOL      |
| operator | 1 SOL     | 5 SOL      | 0.5 SOL       |

## Output Format

All commands return JSON to stdout. Parse output to extract transaction signatures, public keys, and balances.

## Typical Agent Workflow

1. Create agents: `agent-wallet agents:create myagent --role trader`
2. Fund from faucet: `agent-wallet airdrop myagent 2`
3. Operate: transfer SOL, create tokens, mint, transfer tokens
4. Check state: `agent-wallet balances` / `agent-wallet state`

## Code Map

| File | Purpose |
|------|---------|
| `src/keystore.ts` | Encrypted wallet storage (AES-256-GCM + scrypt) |
| `src/solana.ts` | Solana RPC helpers and signing |
| `src/runtime.ts` | Scripted multi-agent demo simulation |
| `src/ai-engine.ts` | LLM-powered decision engine |
| `src/autonomous.ts` | AI autonomous loop — agents think and act |
| `src/spending-policy.ts` | Per-role spending limits |
| `src/assistant.ts` | Conversational TUI handler |
| `src/intents.ts` | Regex-based intent parser |
| `src/chat.ts` | Full-screen AI chat interface |
| `src/voice.ts` | Mic capture + Whisper transcription |
| `src/index.ts` | CLI entrypoint |
