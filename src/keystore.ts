import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { Keypair } from "@solana/web3.js";

import { AGENTS_DIR, MASTER_KEY_ENV, MASTER_KEY_FILE, STATE_FILE, ensureStoreLayout } from "./config.js";
import type { AgentRecord, MintRecord, WalletState } from "./types.js";

function normalizeAgentName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function getAgentPath(name: string): string {
  return join(AGENTS_DIR, `${normalizeAgentName(name)}.json`);
}

async function getMasterKey(): Promise<string> {
  const value = process.env[MASTER_KEY_ENV];
  if (value?.trim()) {
    return value.trim();
  }

  ensureStoreLayout();
  try {
    return (await fs.readFile(MASTER_KEY_FILE, "utf8")).trim();
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }

  const generated = randomBytes(32).toString("base64url");
  try {
    await fs.writeFile(MASTER_KEY_FILE, `${generated}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return generated;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EEXIST") {
      throw error;
    }
    return (await fs.readFile(MASTER_KEY_FILE, "utf8")).trim();
  }
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, 32);
}

async function encryptSecretKey(
  secretKey: Uint8Array,
): Promise<Pick<AgentRecord, "encryptedSecretKey" | "salt" | "iv" | "authTag">> {
  const masterKey = await getMasterKey();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(masterKey, salt), iv);
  const secretKeyBase64 = Buffer.from(secretKey).toString("base64");
  const encrypted = Buffer.concat([cipher.update(secretKeyBase64, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedSecretKey: encrypted.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

async function decryptSecretKey(record: AgentRecord): Promise<Uint8Array> {
  const masterKey = await getMasterKey();
  const salt = Buffer.from(record.salt, "base64");
  const iv = Buffer.from(record.iv, "base64");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(masterKey, salt), iv);
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.encryptedSecretKey, "base64")),
    decipher.final(),
  ]);
  return new Uint8Array(Buffer.from(decrypted.toString("utf8"), "base64"));
}

export async function createAgent(name: string, role = "operator"): Promise<AgentRecord> {
  ensureStoreLayout();
  const normalized = normalizeAgentName(name);
  if (!normalized) {
    throw new Error("Agent name must contain at least one alphanumeric character.");
  }

  const path = getAgentPath(normalized);
  try {
    await fs.access(path);
    throw new Error(`Agent "${normalized}" already exists.`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }

  const keypair = Keypair.generate();
  const encrypted = await encryptSecretKey(keypair.secretKey);
  const record: AgentRecord = {
    name: normalized,
    role,
    publicKey: keypair.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
    ...encrypted,
  };
  await fs.writeFile(path, JSON.stringify(record, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return record;
}

export async function ensureAgent(name: string, role = "operator"): Promise<AgentRecord> {
  const existing = await loadAgentRecord(name);
  if (existing) {
    return existing;
  }
  return createAgent(name, role);
}

export async function loadAgentRecord(name: string): Promise<AgentRecord | null> {
  ensureStoreLayout();
  try {
    const raw = await fs.readFile(getAgentPath(name), "utf8");
    return JSON.parse(raw) as AgentRecord;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function loadAgentKeypair(name: string): Promise<{ record: AgentRecord; keypair: Keypair }> {
  const record = await loadAgentRecord(name);
  if (!record) {
    throw new Error(`Agent "${normalizeAgentName(name)}" was not found.`);
  }
  const secretKey = await decryptSecretKey(record);
  return {
    record,
    keypair: Keypair.fromSecretKey(secretKey),
  };
}

export async function listAgents(): Promise<AgentRecord[]> {
  ensureStoreLayout();
  const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const raw = await fs.readFile(join(AGENTS_DIR, entry.name), "utf8");
        return JSON.parse(raw) as AgentRecord;
      }),
  );
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadState(): Promise<WalletState> {
  ensureStoreLayout();
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw) as WalletState;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { mints: {} };
    }
    throw error;
  }
}

export async function saveState(state: WalletState): Promise<void> {
  ensureStoreLayout();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function upsertMintRecord(record: MintRecord): Promise<void> {
  const state = await loadState();
  state.mints[record.alias] = record;
  await saveState(state);
}

export async function getMintRecord(alias: string): Promise<MintRecord | null> {
  const state = await loadState();
  return state.mints[alias] ?? null;
}

export function formatAgentRow(record: AgentRecord): string {
  return `${record.name.padEnd(12)} ${record.role.padEnd(12)} ${record.publicKey}`;
}
