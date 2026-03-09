# Dependencies & Setup

## Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@solana/web3.js` | ^1.98.4 | Solana RPC client, Keypair, transactions, PublicKey |
| `@solana/spl-token` | ^0.4.14 | SPL token program: mints, transfers, ATAs |
| `commander` | ^14.0.1 | CLI argument parsing and subcommands |
| `groq-sdk` | ^0.37.0 | Groq API client (Llama 3.3, Whisper) |
| `dotenv` | ^17.2.3 | Load .env file into process.env |
| `ink` | ^6.8.0 | React terminal renderer (used by tui.ts, can be removed) |
| `ink-spinner` | ^5.0.0 | Spinner for Ink (can be removed) |
| `ink-text-input` | ^6.0.0 | Text input for Ink (can be removed) |
| `react` | ^19.2.4 | React for Ink (can be removed) |

**Note**: `ink`, `ink-spinner`, `ink-text-input`, and `react` are legacy from when the chat UI used React/Ink. The main chat interface (`chat.ts`) now uses readline + ANSI codes. Only `tui.ts` still references Ink patterns but also uses readline. These can be safely removed.

## Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.8.3 | TypeScript compiler |
| `@types/node` | ^24.0.0 | Node.js type definitions |
| `@types/react` | ^19.2.14 | React types (can be removed with Ink) |
| `tsx` | ^4.20.5 | TypeScript execution for development (`npm run dev`) |

## System Requirements

| Requirement | Details |
|-------------|---------|
| Node.js | >= 20 |
| SoX | For voice commands (`brew install sox` on macOS) |
| Internet | Required for Solana devnet RPC + Groq API |

## Environment Variables

```env
# Required
GROQ_API_KEY=gsk_...                              # Groq API key (free tier)

# Optional
SOLANA_RPC_URL=https://api.devnet.solana.com       # Custom RPC (defaults to devnet)
AGENT_WALLET_MASTER_KEY=...                        # Override auto-generated master key
```

## NPM Scripts

```json
{
  "build": "tsc -p tsconfig.json",           // Compile TypeScript → dist/
  "check": "tsc --noEmit -p tsconfig.json",  // Type-check only
  "cli": "node dist/index.js",               // Run compiled CLI
  "demo": "node dist/index.js demo:run --rounds 2",  // Quick demo
  "dev": "tsx src/index.ts"                   // Run from source (dev mode)
}
```

## TypeScript Configuration

```json
{
  "target": "ES2022",
  "module": "NodeNext",
  "moduleResolution": "NodeNext",
  "strict": true,
  "outDir": "dist",
  "rootDir": "src",
  "jsx": "react-jsx",
  "jsxImportSource": "react"
}
```

## Installation

```bash
# Clone
git clone https://github.com/Nuel-osas/Blacksite.git
cd Blacksite

# Install
npm install

# Create .env
echo "GROQ_API_KEY=your-key-here" > .env

# Build
npm run build

# Run
npm run cli
```

## Runtime Files (Auto-Generated)

```
.agent-wallet/
├── agents/
│   ├── treasury.json    # Encrypted keypair
│   ├── trader.json
│   └── observer.json
├── master.key           # Auto-generated if no env var
└── state.json           # Tracked SPL token mints
```

All gitignored. Regenerated on first run.
