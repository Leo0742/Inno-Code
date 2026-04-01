import path from "node:path";
import fs from "node:fs/promises";

export const defaultSettings = {
  rounds: 3,
  repairAttempts: 1,
  approvalRequiredForApply: true,
  validationCommands: ["npm test", "npm run typecheck", "npm run build"],
  roleModelMap: {
    architect: "gpt-4.1",
    critic: "gpt-4.1-mini",
    implementer: "gpt-4.1",
    judge: "gpt-4.1",
    verifier: "gpt-4.1-mini"
  }
};

export function mergeSettings(nextSettings = {}) {
  const roleModelMap = {
    ...defaultSettings.roleModelMap,
    ...(nextSettings.roleModelMap || {})
  };
  return {
    ...defaultSettings,
    ...nextSettings,
    roleModelMap
  };
}


export function isRuntimeEventForActiveStream(activeStreamId, incomingStreamId) {
  return Boolean(activeStreamId) && activeStreamId === incomingStreamId;
}

export function createPendingPlanStore({ filePath, fsModule = fs } = {}) {
  const pendingPlans = new Map();

  async function persist() {
    if (!filePath) return;
    const serialized = Array.from(pendingPlans.entries()).map(([sessionId, value]) => ({
      sessionId,
      ...value
    }));
    await fsModule.mkdir(path.dirname(filePath), { recursive: true });
    await fsModule.writeFile(filePath, JSON.stringify(serialized, null, 2), "utf8");
  }

  async function restore() {
    if (!filePath) return [];
    try {
      const raw = await fsModule.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      pendingPlans.clear();
      for (const entry of parsed) {
        if (!entry || typeof entry.sessionId !== "string") continue;
        const { sessionId, ...session } = entry;
        pendingPlans.set(sessionId, session);
      }
      return list();
    } catch {
      return [];
    }
  }

  function list() {
    return Array.from(pendingPlans.entries()).map(([sessionId, value]) => ({
      sessionId,
      ...value
    }));
  }

  return {
    async restore() {
      return restore();
    },
    async set(sessionId, value) {
      pendingPlans.set(sessionId, value);
      await persist();
    },
    get(sessionId) {
      return pendingPlans.get(sessionId);
    },
    async delete(sessionId) {
      pendingPlans.delete(sessionId);
      await persist();
    },
    list,
    size() {
      return pendingPlans.size;
    }
  };
}
