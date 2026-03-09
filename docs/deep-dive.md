# Deep Dive: Solana Agentic Wallet Prototype

## Goal

The prototype demonstrates a wallet system built for AI agents on Solana devnet. It focuses on secure local custody, autonomous signing, protocol interaction, and support for multiple agents acting independently.

## Design overview

The implementation is split into six layers:

1. Keystore: creates agent wallets and encrypts their secret keys on disk.
2. Solana adapter: exposes RPC and transaction helpers for SOL and SPL token flows.
3. Agent runtime: scripted simulation loop + AI autonomous decision loop.
4. AI engine: Claude-powered decision-making and voice intent parsing.
5. Voice layer: microphone capture (SoX) + Whisper transcription pipeline.
6. Spending policies: per-role transaction and hourly limits enforced before signing.

This separation is deliberate. The runtime decides what should happen. The wallet layer only handles signing and execution. That makes it easier to audit and replace the agent logic later.

## Wallet model

Each agent gets its own Solana keypair and JSON file under `.agent-wallet/agents/`.

Stored fields:

- Public key
- Role label
- Encrypted secret key payload
- Salt, IV, and auth tag for AES-256-GCM
- Creation timestamp

Private keys are encrypted using a key derived with `scrypt`. By default, the prototype auto-generates a local master key in `.agent-wallet/master.key`. If `AGENT_WALLET_MASTER_KEY` is provided, it overrides that local file. This is not production-grade custody, but it is a meaningful step above plaintext storage and is appropriate for a hackathon-style local prototype.

## Autonomous behavior

The default runtime provisions three agents:

- `treasury`: fee sponsor, mint authority, and reserve wallet
- `trader`: receives SPL inventory and performs token transfers
- `observer`: receives token flow and returns SOL as a mock settlement

Per simulation round:

1. Treasury checks whether trader and observer have enough SOL to keep operating.
2. Treasury tops them up if their balance drops below configured thresholds.
3. Treasury mints SANDBOX SPL tokens to trader.
4. Trader transfers a portion of that inventory to observer.
5. Observer settles a small amount of SOL back to treasury.
6. Memo instructions are attached so the execution rationale is visible on-chain.

This is a sandbox, not an alpha-seeking strategy. The point is to show agents making wallet-driven decisions without manual signing.

## Protocol interaction

The prototype uses Solana devnet and interacts with:

- System Program for SOL transfers
- SPL Token Program for minting and transfers
- Memo Program for execution audit trails

That is enough to satisfy the bounty requirement around holding SOL or SPL tokens and interacting with a protocol in a safe test environment.

## AI autonomous mode

The `ai:run` command replaces scripted logic with real AI reasoning. Each round:

1. All agent balances and spending limits are gathered.
2. For each agent, a prompt is sent to Claude with the agent's role, balances, limits, and peer state.
3. Claude returns a structured JSON decision: which action to take and why.
4. The spending policy is checked before any transaction is signed.
5. The action executes on devnet and the result is logged.

This demonstrates AI agents making genuine autonomous financial decisions — not scripted behavior.

## Spending policies

Every transaction goes through a spending policy check before signing:

| Role | Max per tx | Max per hour | Confirm above |
|------|-----------|-------------|---------------|
| treasury | 5 SOL | 20 SOL | 3 SOL |
| trader | 2 SOL | 10 SOL | 1 SOL |
| observer | 0.5 SOL | 2 SOL | 0.25 SOL |
| operator | 1 SOL | 5 SOL | 0.5 SOL |

Hourly spends are tracked in-memory with a rolling window. This prevents runaway AI spending even if Claude makes an aggressive decision.

## Speech-to-action

The `voice` command implements a complete speech-to-action pipeline:

```
Microphone (SoX) → WAV recording → OpenAI Whisper → transcript → Claude intent parser → action → wallet execution
```

The voice layer reuses the same action routing as the CLI. Both voice and typed commands converge at the same execution path, so every wallet action that works in the CLI also works via voice.

Voice commands are parsed by Claude (not regex), so natural phrasing works:
- "Send half a SOL from treasury to trader"
- "Airdrop 2 SOL to the observer"
- "What are the balances?"

The regex-based `intents.ts` remains as an offline fallback when API keys are not available.

## Security considerations

What this prototype does well:

- avoids plaintext secret keys on disk
- isolates key material per agent
- separates decision logic from signing and RPC execution
- keeps operations on devnet by default
- makes autonomous actions auditable through memo annotations

What it does not solve yet:

- hardware-backed custody
- multi-party approval policies
- transaction simulation before every execution
- policy proofs or formal verification
- secure remote execution

## Scalability

The keystore layout and runtime model support multiple agents independently because each agent:

- has its own keypair
- can receive its own SOL funding
- can own its own token accounts
- can participate in shared protocol flows without sharing secret keys

The next step for scale would be moving from simple role-based scripts to a scheduler that continuously evaluates agent state and risk budgets.

## Suggested next iteration

- Add Jupiter or another devnet protocol adapter for swap demos.
- Add transaction simulation before signing live transactions.
- Add multi-sig or threshold signing for high-value transactions.
- Add persistent audit log for all AI decisions and transaction outcomes.
- Add TTS (text-to-speech) feedback in voice mode for fully hands-free operation.
