# AI Integration Details

## AI Provider: Groq

### Why Groq
- **Free tier** — no credit card required, generous rate limits
- **Fast inference** — optimized hardware for low latency
- **OpenAI-compatible** — familiar API, easy to swap providers
- **Good models** — Llama 3.3 70B is strong at tool-calling and reasoning

### Models Used

| Model | Purpose | Where |
|-------|---------|-------|
| `llama-3.3-70b-versatile` | Chat + tool-calling, autonomous decisions, voice intent parsing | chat.ts, ai-engine.ts |
| `whisper-large-v3` | Audio transcription | voice.ts |

### SDK
```typescript
import Groq from "groq-sdk";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
```

---

## Chat Tool-Calling (chat.ts)

### How the Agentic Loop Works

```typescript
// 1. Send user message + tools to Groq
let response = await groq.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages,          // system + conversation history
  tools: TOOLS,      // 15 function definitions
  tool_choice: "auto",
  max_tokens: 4096,
});

// 2. While LLM wants to call tools, execute them
while (response.choices[0]?.finish_reason === "tool_calls") {
  const toolCalls = response.choices[0].message.tool_calls;

  for (const tc of toolCalls) {
    const result = await executeTool(tc.function.name, JSON.parse(tc.function.arguments));
    messages.push({ role: "tool", tool_call_id: tc.id, content: result });
  }

  // 3. Send tool results back, get next response
  response = await groq.chat.completions.create({ model, messages, tools, tool_choice: "auto" });
}

// 4. Final text response
return response.choices[0]?.message?.content;
```

### Key Design Decisions
- **tool_choice: "auto"** — LLM decides when to use tools vs respond with text
- **Multi-step loops** — LLM can chain multiple tool calls (e.g., create agent → airdrop → check balance)
- **Error handling** — tool errors returned as strings, LLM can retry or explain the error
- **Message history** — full conversation preserved for context

### System Prompt
```
You are an AI wallet assistant managing Solana devnet agent wallets. You help users create wallets,
transfer SOL and tokens, run demos, and manage multi-agent autonomous flows.

Key concepts:
- Agents are named wallets with encrypted keypairs
- Each agent has a role that determines spending limits
- All operations happen on Solana devnet (no real money)
- You can send SOL/tokens to BOTH registered agents (by name) AND external Solana addresses (by public key)
- If the recipient looks like a Solana public key (base58 string), use transfer_sol_to_address
- If the recipient is an agent name, use transfer_sol or transfer_tokens
```

---

## Autonomous Decision Engine (ai-engine.ts)

### Context Building
Each agent gets a prompt containing:
```
You are agent "treasury" with role "treasury".
Round: 1

Your balances:
- SOL: 4.5000
- SANDBOX: 1000

Spending limits:
- Max per tx: 5 SOL
- Hourly spent: 0.0000 SOL
- Hourly remaining: 20.0000 SOL

Other agents: trader, observer

Other agent balances:
- trader: SOL=2.3000, tokens=SANDBOX:500
- observer: SOL=0.8000, tokens=SANDBOX:100
```

### Decision Format
```json
{
  "action": "transfer_sol",
  "params": { "to": "trader", "amount": "0.5" },
  "reasoning": "Trader balance is getting low, topping up for next round"
}
```

### Available Actions
- `transfer_sol` — send SOL to another agent
- `transfer_token` — send tokens to another agent
- `airdrop` — request devnet SOL
- `mint_tokens` — create new tokens
- `hold` — do nothing this round
- `check_balance` — just check balances

### AI Rules (from system prompt)
- Never exceed spending limits
- Keep at least 0.05 SOL for transaction fees
- Align decisions with assigned role
- If balances are low, request an airdrop
- Prefer small, frequent transactions over large ones

---

## Voice Intent Parsing (ai-engine.ts)

### How It Works
```typescript
const response = await groq.chat.completions.create({
  model: "llama-3.3-70b-versatile",
  messages: [
    { role: "system", content: `You parse voice commands into Solana wallet actions. Available agents: ${agents.join(", ")}.` },
    { role: "user", content: transcript },  // "send half a sol from treasury to trader"
  ],
});
// Returns structured JSON like:
// { "action": "transfer_sol", "params": { "from": "treasury", "to": "trader", "amount": "0.5" }, "reasoning": "..." }
```

---

## Audio Transcription (voice.ts)

### Groq Whisper
```typescript
const transcription = await groq.audio.transcriptions.create({
  file: createReadStream(audioPath),  // WAV file from microphone
  model: "whisper-large-v3",
  language: "en",
  response_format: "text",
});
```

- Uses file stream (not base64) for efficiency
- 16kHz mono WAV input from SoX
- Returns plain text transcript

---

## Provider History

The project went through several AI providers before settling on Groq:

1. **Gemini** — initial implementation, worked but switched for variety
2. **Claude API (Anthropic)** — attempted, but 400 error due to no credits ("credit balance too low")
3. **Gemini (again)** — temporary fallback
4. **Local regex parser** — offline intent parsing (still available as fallback in intents.ts)
5. **Groq** — final choice, free tier, fast, good tool-calling support

### Switching Providers
To switch AI providers, you'd need to modify:
- `chat.ts` — swap Groq SDK calls for new provider's SDK
- `ai-engine.ts` — swap decision engine calls
- `voice.ts` — swap Whisper for new transcription service
- Tool definitions may need format changes depending on provider's function calling spec
