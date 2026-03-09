# Lessons Learned & Next Steps

## What Worked Well

### 1. Groq Free Tier
- No credit card, generous limits, fast responses
- Tool-calling with Llama 3.3 works reliably for wallet operations
- Whisper transcription is fast and accurate

### 2. AES-256-GCM Encryption
- Simple, battle-tested encryption for local key storage
- Per-agent salt/IV is a clean security model
- scrypt KDF adds meaningful brute-force protection

### 3. readline Over Ink/React
- Ink's TextInput had persistent focus issues (couldn't type)
- Switching to plain readline solved all input problems immediately
- ANSI escape codes give full control over terminal styling without a framework

### 4. Tool-Calling Agentic Loop
- Groq's function calling lets the LLM chain multiple operations naturally
- User says "bootstrap and then airdrop 2 SOL" → LLM calls bootstrap_demo → then airdrop_sol
- Much more flexible than regex intent parsing

### 5. Solana web3.js Already Accepts PublicKey
- `transferSol()` already took `recipient: PublicKey`, not an agent name
- Adding external address support just needed a new tool that constructs `new PublicKey(address)` instead of calling `loadAgentKeypair()`

## What Didn't Work

### 1. Ink/React for Terminal UI
- TextInput component couldn't receive keyboard input reliably
- Raw mode and focus management were fragile
- Abandoned entirely for readline + ANSI codes

### 2. Anthropic Claude API
- 400 error: "credit balance is too low"
- Free tier insufficient for agentic usage
- Groq's free tier is far more generous

### 3. Pure Regex Intent Parsing
- Fragile: "airdrop 1 sol to trader" works but "give 1 sol to trader" doesn't
- Expanding patterns is tedious and error-prone
- AI tool-calling is strictly better when available
- Still useful as offline fallback

### 4. Initial Tool Design
- Original `transfer_sol` only accepted agent names
- When user tried to send to an external public key, the LLM tried to use `transfer_sol` with a public key as `to`, which called `loadAgentKeypair()` and crashed
- Fix: added `transfer_sol_to_address` and `transfer_tokens_to_address` tools

---

## Known Issues

1. **Spending policy not enforced in chat mode** — only in autonomous mode
2. **Spending tracking is in-memory** — resets when process restarts
3. **No transaction simulation** — transactions execute immediately without preview
4. **Devnet rate limits** — airdrops can fail if too frequent
5. **No tests** — no unit, integration, or e2e tests
6. **Ink dependencies still in package.json** — can be removed since chat uses readline

---

## What to Build Next

### High Priority (Bounty Relevance)

1. **Protocol integrations** — Interact with real Solana protocols:
   - Jupiter (token swaps)
   - Marinade (liquid staking)
   - Raydium (AMM/DEX)
   - Add tools: `swap_tokens`, `stake_sol`, `provide_liquidity`

2. **Transaction simulation** — Preview transaction effects before signing:
   - Use `simulateTransaction` RPC call
   - Show expected balance changes
   - Abort if simulation fails

3. **Multi-agent coordination** — Agents communicating directly:
   - Agent-to-agent messaging
   - Conditional actions ("if trader buys X, treasury funds Y")
   - Shared goals and negotiation

4. **Persistent audit log** — All transactions logged to database:
   - Who signed, what amount, tx signature, reasoning
   - Queryable history
   - Exportable for compliance

### Medium Priority

5. **Web UI** — Browser-based interface:
   - Real-time balance dashboard
   - Transaction history visualization
   - Agent activity timeline

6. **Multi-sig support** — Require N-of-M agent signatures:
   - Treasury actions require 2-of-3 approval
   - Prevents single-agent compromise

7. **Mainnet support** — Configurable network:
   - Network selection (devnet/testnet/mainnet)
   - Stricter spending limits on mainnet
   - Mandatory transaction simulation

8. **Better AI context** — Agent memory and learning:
   - Remember past transactions
   - Learn from outcomes (did the trade profit?)
   - Adjust strategy over time

### Nice to Have

9. **Plugin system** — Add new tools without modifying core:
   - Tool registry
   - External tool providers
   - Custom action types

10. **Webhook notifications** — Real-time alerts:
    - Large transaction alerts
    - Balance threshold warnings
    - Agent decision notifications

11. **Remove unused Ink dependencies** — Clean up package.json:
    - Remove `ink`, `ink-spinner`, `ink-text-input`, `react`, `@types/react`
    - Chat now uses readline, not React

---

## Bounty Alignment

The $5,000 Solana bounty requires:

| Requirement | Status |
|-------------|--------|
| Create wallets | Done — `createAgent()` with encryption |
| Sign transactions | Done — `transferSol()`, `mintTokens()`, etc. |
| Hold funds | Done — agents hold SOL + SPL tokens |
| Interact with protocols | Partial — SPL tokens + memo program, no DEX/staking yet |
| AI-powered decisions | Done — Groq autonomous mode |
| Secure key management | Done — AES-256-GCM + scrypt |
| Multi-agent | Done — treasury/trader/observer with coordination |
| Spending limits | Done — per-role policy enforcement |

### Strongest Differentiators
1. Full agentic loop with 15 tools (not just a wrapper around one API call)
2. Real Solana transactions on devnet with memo audit trails
3. Voice-to-blockchain pipeline (speak → transcribe → sign → confirm)
4. Encrypted local custody with per-agent isolation
5. Natural language chat interface with streaming output
