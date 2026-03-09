# Repository Skills

This file describes the operating assumptions another agent should follow when working in this repository.

## Primary objective

Build and maintain a Solana devnet agentic wallet prototype that demonstrates:

- programmatic wallet creation
- automated signing
- SOL and SPL token custody
- protocol interaction
- multi-agent support

## Safe workflow

1. Keep the default network on Solana devnet unless explicitly told otherwise.
2. Never store raw private keys in plaintext files or docs.
3. Use `AGENT_WALLET_MASTER_KEY` for encrypted keystore operations.
4. Keep agent logic separate from wallet execution logic.
5. Prefer extending the CLI and runtime instead of building an unnecessary frontend first.

## Code map

- `src/keystore.ts`: encrypted wallet storage (AES-256-GCM + scrypt)
- `src/solana.ts`: Solana helpers and signing flows
- `src/runtime.ts`: scripted multi-agent simulation loop
- `src/ai-engine.ts`: Claude-powered decision engine + voice intent parser
- `src/voice.ts`: microphone capture (SoX) + Whisper transcription
- `src/autonomous.ts`: AI autonomous loop — agents think and act independently
- `src/spending-policy.ts`: per-role spending limits enforced before signing
- `src/assistant.ts`: conversational TUI handler
- `src/intents.ts`: regex-based intent parser (offline fallback)
- `src/tui.ts`: interactive terminal dashboard
- `src/index.ts`: CLI entrypoint

## AI autonomous mode

- `ai:run --rounds N`: Claude decides what each agent does per round.
- Each agent sees its balances, spending limits, and peer state.
- Claude returns a structured action (transfer, airdrop, mint, hold).
- Spending policies enforced before every transaction.

## Voice commands

- `voice --duration N`: mic → Whisper transcription → Claude intent parsing → wallet execution.
- Requires SoX (`brew install sox`) and `OPENAI_API_KEY`.
- Say "exit" to stop the voice loop.

## Spending policies

- Per-role limits: max per transaction, max per hour, confirmation threshold.
- Roles: treasury (5/20 SOL), trader (2/10 SOL), observer (0.5/2 SOL), operator (1/5 SOL).
- `spending <agent>`: view current limits and hourly spend.

## Demo expectations

The demo path should remain simple:

1. Create or reuse default agents.
2. Fund them on devnet.
3. Create or reuse a sandbox SPL mint.
4. Run autonomous rounds with auditable memos.
5. Show balances and transaction signatures.
6. Optionally run `ai:run` for Claude-driven autonomous rounds.
7. Optionally run `voice` for speech-to-action demo.
