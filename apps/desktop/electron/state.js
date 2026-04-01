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

  function normalizeSession(entry) {
    if (!entry || typeof entry !== "object" || typeof entry.sessionId !== "string") return null;
    const { sessionId, ...session } = entry;
    if (!session || typeof session !== "object") return null;
    if (typeof session.task !== "string" || typeof session.projectPath !== "string" || typeof session.finalPlan !== "string") {
      return null;
    }
    if (!session.settings || typeof session.settings !== "object") {
      return null;
    }
    return {
      sessionId,
      session: {
        ...session,
        settings: mergeSettings(session.settings),
        proposedDiff: typeof session.proposedDiff === "string" ? session.proposedDiff : "No proposed diff generated.",
        predictedChangedFiles: Array.isArray(session.predictedChangedFiles) ? session.predictedChangedFiles : [],
        implementationChecklist: Array.isArray(session.implementationChecklist) ? session.implementationChecklist : []
      }
    };
  }

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
      if (!Array.isArray(parsed)) {
        pendingPlans.clear();
        await persist();
        return [];
      }
      pendingPlans.clear();
      for (const entry of parsed) {
        const normalized = normalizeSession(entry);
        if (!normalized) continue;
        pendingPlans.set(normalized.sessionId, normalized.session);
      }
      await persist();
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
    async reconcileExactPreviews(reconciler) {
      let changed = false;
      for (const [sessionId, session] of pendingPlans.entries()) {
        const nextSession = await reconciler(session, sessionId);
        if (nextSession && nextSession !== session) {
          pendingPlans.set(sessionId, nextSession);
          changed = true;
        }
      }
      if (changed) await persist();
      return list();
    },
    list,
    size() {
      return pendingPlans.size;
    }
  };
}
