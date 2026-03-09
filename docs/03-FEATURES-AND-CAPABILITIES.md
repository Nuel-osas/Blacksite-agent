# Features & Capabilities

## 1. Wallet Management

### Agent Creation
- Create named wallets with roles: `treasury`, `trader`, `observer`, `operator`
- Each agent gets a fresh Solana Keypair
- Private key encrypted with AES-256-GCM + scrypt before writing to disk
- File permissions locked to 0o600

```
"create agent alice as trader"
→ Generates keypair
→ Encrypts with master key
→ Writes to .agent-wallet/agents/alice.json
```

### Bootstrap Demo
- One command creates treasury + trader + observer
- Airdrops devnet SOL to each
- Ready for demo simulation or autonomous mode

```
"bootstrap the demo"
→ Creates 3 agents
→ Airdrops 1 SOL each
```

### Agent Listing
- View all agents with names, roles, and public keys
- Query balances for individual or all agents

---

## 2. SOL Operations

### Airdrops (Devnet Faucet)
- Request free devnet SOL for any agent
- Waits for transaction confirmation
- Rate-limited by Solana devnet (~2 SOL per request)

### Transfers Between Agents
- Send SOL from one named agent to another
- Optional memo field for on-chain audit trails
- Spending policy checked before signing

### Transfers to External Addresses
- Send SOL to ANY Solana public key (base58 address)
- Not limited to registered agents
- Enables interaction with external wallets, DEXes, protocols

```
"send 0.1 SOL from treasury to AfWin6Ev1MRwZALsFVHrCRRWPiPhbEK5qmuBDBAwGhAd"
→ Uses transfer_sol_to_address tool
→ Constructs PublicKey from base58 string
→ Signs and sends transaction
```

---

## 3. SPL Token Operations

### Create Token Mints
- Create new SPL tokens with custom alias and decimals
- Mint authority assigned to an agent
- Tracked in `.agent-wallet/state.json`

```
"create token USDC with treasury"
→ Creates mint on Solana devnet
→ Treasury becomes mint authority
→ Tracked as alias "USDC"
```

### Mint Tokens
- Mint tokens to any agent's associated token account (ATA)
- ATAs created automatically if missing
- Authority agent signs the mint instruction

```
"mint 1000 USDC to trader"
→ Treasury (authority) mints 1000 USDC
→ Trader's ATA created if needed
```

### Transfer Tokens
- Between agents (by name)
- To external addresses (by public key)
- Automatic ATA creation for recipients
- Uses `transferChecked` instruction for safety

---

## 4. AI Chat Interface (Primary UI)

### Groq Tool-Calling
- 15 tools registered with Groq's function calling API
- LLM decides which tools to invoke based on user's natural language
- Multi-step agentic loop: LLM → tools → results → LLM → response

### Tools Available to the LLM

| Tool | What It Does |
|------|-------------|
| `create_agent` | Create new agent wallet |
| `list_agents` | List all registered agents |
| `get_balances` | Query SOL + token balances |
| `airdrop_sol` | Request devnet SOL |
| `transfer_sol` | Send SOL between agents |
| `transfer_sol_to_address` | Send SOL to external public key |
| `create_token_mint` | Create new SPL token |
| `mint_tokens` | Mint tokens to agent |
| `transfer_tokens` | Send tokens between agents |
| `transfer_tokens_to_address` | Send tokens to external public key |
| `bootstrap_demo` | Create 3 demo agents + airdrop |
| `run_demo_simulation` | Run scripted demo rounds |
| `run_ai_autonomous` | Run AI autonomous rounds |
| `get_spending_limits` | View agent spending policy |
| `get_wallet_state` | Get tracked mints + state |

### Auraai-Styled Terminal UI
- User messages: right-aligned blue bubbles
- AI responses: left-aligned, character-by-character streaming
- Tool execution: dark chips with colored dots
- Spinner animation during thinking/execution
- Color palette: heat (orange), amethyst (purple), bluetron (blue), forest (green), honey (yellow), crimson (red)

### Special Commands
- `/clear` — Clear screen
- `/history` — Show conversation length
- `?` or `/help` — Help text
- `exit` / `quit` — Exit

---

## 5. AI Autonomous Mode

### How It Works
1. Each round, every agent gets a prompt with:
   - Their name, role, balances
   - Spending limits and usage
   - All other agents' balances
2. Groq LLM returns a JSON decision (action + params + reasoning)
3. Spending policy validated before execution
4. Transaction signed and sent
5. Results logged

### Agent Roles
- **Treasury**: manages funds, mints tokens, tops up low balances
- **Trader**: moves tokens, makes transfers
- **Observer**: settles small payments, monitors

### Safety
- Spending limits enforced per-role
- Hourly rolling window prevents gradual drain
- All decisions logged with reasoning

```
"run 3 autonomous rounds"
→ Round 1: treasury airdrops, trader holds, observer checks balance
→ Round 2: treasury mints tokens, trader transfers, observer settles
→ Round 3: all agents make independent decisions
```

---

## 6. Scripted Demo Simulation

### What It Does
Each round performs a fixed sequence:
1. Treasury tops up trader SOL if < 0.25
2. Treasury tops up observer SOL if < 0.15
3. Treasury mints 25 SANDBOX tokens to trader
4. Trader transfers 10 SANDBOX tokens to observer
5. Observer sends 0.01 SOL back to treasury

### Memos
Every transaction includes an on-chain memo for audit trail:
- "Round 1: treasury→trader SOL top-up"
- "Round 1: mint 25 SANDBOX to trader"
- "Round 1: trader→observer 10 SANDBOX"
- "Round 1: observer→treasury settlement 0.01 SOL"

---

## 7. Voice Commands

### Pipeline
```
Microphone → WAV file → Groq Whisper → Text → Groq LLM → Action
```

### Requirements
- SoX installed (`brew install sox` on macOS)
- Groq API key (for Whisper transcription)

### Usage
```
"voice mode"
→ Listens for 5 seconds
→ Transcribes with whisper-large-v3
→ Parses intent with Groq LLM
→ Executes wallet action
→ Loops until "exit"
```

### Example Voice Commands
- "Airdrop 2 SOL to treasury"
- "Send half a SOL from treasury to trader"
- "What are the balances?"
- "Exit" (stops voice loop)

---

## 8. Spending Policy

### Per-Role Limits

| Role | Max per tx | Max per hour | Confirm above |
|------|-----------|-------------|---------------|
| treasury | 5 SOL | 20 SOL | 3 SOL |
| trader | 2 SOL | 10 SOL | 1 SOL |
| observer | 0.5 SOL | 2 SOL | 0.25 SOL |
| operator | 1 SOL | 5 SOL | 0.5 SOL |

### Enforcement
- Checked before every autonomous transaction
- Hourly window is rolling (last 60 minutes)
- In-memory tracking (resets on process restart)
- Blocked transactions logged with reason

---

## 9. Regex Intent Parser (Offline Fallback)

When AI APIs are unavailable, intents.ts provides regex-based parsing:

| Intent | Example Phrases |
|--------|----------------|
| bootstrap | "bootstrap the demo", "setup demo with 2 sol" |
| create-agent | "create agent alice", "new agent bob as trader" |
| list-agents | "list agents", "show agents" |
| balances | "show balances", "balance of treasury" |
| airdrop | "airdrop 1 sol to trader", "fund trader 1 sol" |
| transfer-sol | "send 0.5 sol from treasury to trader" |
| create-mint | "create token USDC with treasury" |
| mint | "mint 1000 USDC to trader via treasury" |
| transfer-token | "transfer 100 USDC from trader to observer" |
| simulate | "run 2 demo rounds" |
| autonomous | "run 3 autonomous rounds", "ai mode" |
| spending | "spending limits for trader" |
| state | "show wallet state" |

---

## 10. CLI Subcommands

Full Commander.js CLI for scripting and automation:

```bash
# Agent management
npm run cli -- agents:create <name> --role <role>
npm run cli -- agents:list

# Balances
npm run cli -- balances [agent]

# SOL operations
npm run cli -- airdrop <agent> <amount>
npm run cli -- transfer:sol <from> <to> <amount> --memo "optional"

# Token operations
npm run cli -- token:create <alias> <authority> --decimals 6
npm run cli -- token:mint <alias> <authority> <recipient> <amount>
npm run cli -- token:transfer <alias> <from> <to> <amount>

# Demo
npm run cli -- demo:bootstrap --airdrop 1
npm run cli -- demo:run --rounds 2
npm run cli -- demo:all --airdrop 1 --rounds 3

# AI autonomous
npm run cli -- ai:run --rounds 3

# Voice
npm run cli -- voice --duration 5

# Spending
npm run cli -- spending <agent>

# State
npm run cli -- state

# Interactive
npm run cli              # Default: chat interface
npm run cli -- chat      # Explicit: AI chat
npm run cli -- tui       # Dashboard view

# Natural language
npm run cli -- intent "send 0.5 sol from treasury to trader"
```
