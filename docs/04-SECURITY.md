# Security Architecture

## Encryption Model

### Key Hierarchy

```
AGENT_WALLET_MASTER_KEY (env var or .agent-wallet/master.key)
        │
        ▼ scrypt(masterKey, perAgentSalt, 32)
        │
   Derived AES Key (unique per agent)
        │
        ▼ AES-256-GCM(derivedKey, iv)
        │
   Encrypted Secret Key (stored on disk)
```

### Master Key
- **Priority 1**: `AGENT_WALLET_MASTER_KEY` environment variable
- **Priority 2**: Read from `.agent-wallet/master.key` file
- **Priority 3**: Auto-generate random 32-byte base64 key, write to file with 0o600 permissions

### Per-Agent Encryption
Each agent's private key is encrypted individually with:
- **Random salt** (16 bytes) — unique per agent, used for scrypt key derivation
- **Random IV** (12 bytes) — unique per agent, used for AES-GCM
- **Auth tag** (16 bytes) — GCM authentication tag for integrity verification
- **Algorithm**: AES-256-GCM (authenticated encryption with associated data)
- **KDF**: scrypt with N=2^15, r=8, p=1

### Agent Record (JSON on disk)
```json
{
  "name": "treasury",
  "role": "treasury",
  "publicKey": "base58-public-key",
  "encryptedSecretKey": "base64-ciphertext",
  "salt": "base64-16-bytes",
  "iv": "base64-12-bytes",
  "authTag": "base64-16-bytes",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

### File Permissions
- All files in `.agent-wallet/` written with mode `0o600` (owner read/write only)
- Master key file: `0o600`
- Agent JSON files: `0o600`

## Spending Policy

### Why It Matters
Without limits, an AI agent with a private key could drain an entire wallet in one transaction. The spending policy adds guardrails:

1. **Per-transaction limit**: No single tx can exceed the role's maximum
2. **Hourly rolling window**: Total spend in last 60 minutes capped
3. **Confirmation threshold**: Large transactions flagged (currently logged, not blocked interactively)

### Role Limits

| Role | Max/tx | Max/hour | Flag above |
|------|--------|----------|------------|
| treasury | 5 SOL | 20 SOL | 3 SOL |
| trader | 2 SOL | 10 SOL | 1 SOL |
| observer | 0.5 SOL | 2 SOL | 0.25 SOL |
| operator | 1 SOL | 5 SOL | 0.5 SOL |

### Enforcement Points
- **Autonomous mode**: checked before every AI-initiated transaction
- **Chat mode**: the AI can call tools freely (spending policy not enforced in chat — user is in control)
- **CLI commands**: no enforcement (direct user intent)

## What's Secure

- Private keys never stored in plaintext
- Per-agent salt/IV prevents key reuse attacks
- GCM auth tag prevents ciphertext tampering
- scrypt KDF makes brute-force impractical
- File permissions restrict access
- Devnet-only (no real funds at risk)
- Spending limits prevent autonomous drain

## What's NOT Included (Production Gaps)

These would be needed for a production system:

1. **Hardware wallet / HSM integration** — keys should live in secure enclaves
2. **Multi-signature / threshold signing** — no single point of compromise
3. **Transaction simulation** — preview effects before signing
4. **Persistent audit logs** — spending tracking resets on restart
5. **Rate limiting on RPC calls** — no protection against devnet rate limits
6. **Key rotation** — no mechanism to rotate master key or agent keys
7. **Secure memory handling** — decrypted keys held in normal JS memory
8. **Access control** — anyone with filesystem access can use the tool
9. **Network security** — RPC calls over HTTPS but no cert pinning
10. **Formal verification** — no proofs of policy correctness

## Threat Model

### Protected Against
- **Disk theft**: encrypted keys, attacker needs master key
- **Key reuse**: per-agent salt/IV
- **Ciphertext tampering**: GCM auth tag verification
- **Accidental overspend**: role-based limits in autonomous mode

### NOT Protected Against
- **Memory dump**: decrypted keys in JS heap
- **Compromised master key**: full access to all agents
- **Malicious LLM output**: AI could craft harmful transactions within limits
- **RPC manipulation**: no transaction simulation or verification
- **Process injection**: no sandboxing or isolation
