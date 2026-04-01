import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function toBase64(value) {
  return Buffer.from(value).toString("base64");
}

function fromBase64(value) {
  return Buffer.from(value, "base64");
}

async function ensureJsonFile(filePath, defaultValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2), { encoding: "utf8", mode: 0o600 });
    return defaultValue;
  }
}

export function createCredentialStore({ dataPath }) {
  const keyPath = path.join(dataPath, "credentials.key.json");
  const secretsPath = path.join(dataPath, "credentials.secrets.json");

  async function loadOrCreateKeyMaterial() {
    const keyFile = await ensureJsonFile(keyPath, {
      salt: toBase64(crypto.randomBytes(16)),
      seed: toBase64(crypto.randomBytes(32))
    });
    const derived = crypto.scryptSync(fromBase64(keyFile.seed), fromBase64(keyFile.salt), 32);
    return derived;
  }

  async function loadSecrets() {
    return ensureJsonFile(secretsPath, { secrets: {} });
  }

  async function saveSecrets(payload) {
    await fs.mkdir(path.dirname(secretsPath), { recursive: true });
    await fs.writeFile(secretsPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  async function encryptSecret(plainValue) {
    const key = await loadOrCreateKeyMaterial();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plainValue, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      cipherText: toBase64(encrypted),
      iv: toBase64(iv),
      tag: toBase64(tag),
      version: 1,
      updatedAt: new Date().toISOString()
    };
  }

  async function decryptSecret(encryptedPayload) {
    const key = await loadOrCreateKeyMaterial();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, fromBase64(encryptedPayload.iv));
    decipher.setAuthTag(fromBase64(encryptedPayload.tag));
    const plain = Buffer.concat([decipher.update(fromBase64(encryptedPayload.cipherText)), decipher.final()]);
    return plain.toString("utf8");
  }

  return {
    storageKind: "encrypted_local_file",
    async setSecret(credentialRef, plainValue) {
      const payload = await loadSecrets();
      payload.secrets[credentialRef] = await encryptSecret(plainValue);
      await saveSecrets(payload);
      return { ok: true };
    },
    async hasSecret(credentialRef) {
      const payload = await loadSecrets();
      return Boolean(payload.secrets[credentialRef]);
    },
    async getSecret(credentialRef) {
      const payload = await loadSecrets();
      const encrypted = payload.secrets[credentialRef];
      if (!encrypted) return null;
      try {
        return await decryptSecret(encrypted);
      } catch {
        return null;
      }
    },
    async deleteSecret(credentialRef) {
      const payload = await loadSecrets();
      delete payload.secrets[credentialRef];
      await saveSecrets(payload);
    }
  };
}
