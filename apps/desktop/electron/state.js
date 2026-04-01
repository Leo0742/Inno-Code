import path from "node:path";
import fs from "node:fs/promises";

const roleOrder = ["architect", "critic", "implementer", "judge", "verifier"];

function createDefaultProviderProfile() {
  return {
    id: "default-openai",
    displayName: "Default OpenAI Compatible",
    providerType: "openai_compatible",
    endpoint: "https://api.openai.com/v1",
    credentialRef: "provider:default-openai",
    organization: "",
    project: "",
    extraHeaders: {},
    modelPresets: {
      architect: "gpt-4.1",
      critic: "gpt-4.1-mini",
      implementer: "gpt-4.1",
      judge: "gpt-4.1",
      verifier: "gpt-4.1-mini"
    },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function mapLegacyRoleModelMap(legacyRoleModelMap = {}) {
  const roleModelSelections = {};
  for (const role of roleOrder) {
    roleModelSelections[role] = {
      profileId: "default-openai",
      model: legacyRoleModelMap[role] ?? createDefaultProviderProfile().modelPresets[role]
    };
  }
  return roleModelSelections;
}

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
  },
  providerProfiles: [createDefaultProviderProfile()],
  roleModelSelections: mapLegacyRoleModelMap()
};

function normalizeProviderProfile(profile, nowIso) {
  if (!profile || typeof profile !== "object") return null;
  const id = typeof profile.id === "string" && profile.id.trim() ? profile.id.trim() : null;
  if (!id) return null;
  const providerType = typeof profile.providerType === "string" ? profile.providerType : "openai_compatible";
  return {
    id,
    displayName: typeof profile.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : id,
    providerType,
    endpoint: typeof profile.endpoint === "string" ? profile.endpoint.trim() : "",
    credentialRef: typeof profile.credentialRef === "string" && profile.credentialRef.trim() ? profile.credentialRef.trim() : `provider:${id}`,
    organization: typeof profile.organization === "string" ? profile.organization : "",
    project: typeof profile.project === "string" ? profile.project : "",
    extraHeaders: profile.extraHeaders && typeof profile.extraHeaders === "object" ? profile.extraHeaders : {},
    modelPresets: profile.modelPresets && typeof profile.modelPresets === "object" ? profile.modelPresets : {},
    enabled: profile.enabled !== false,
    createdAt: typeof profile.createdAt === "string" ? profile.createdAt : nowIso,
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : nowIso
  };
}

export function mergeSettings(nextSettings = {}) {
  const nowIso = new Date().toISOString();
  const roleModelMap = {
    ...defaultSettings.roleModelMap,
    ...(nextSettings.roleModelMap || {})
  };

  const normalizedProfiles = Array.isArray(nextSettings.providerProfiles)
    ? nextSettings.providerProfiles.map((profile) => normalizeProviderProfile(profile, nowIso)).filter(Boolean)
    : [];

  const providerProfiles = normalizedProfiles.length
    ? normalizedProfiles
    : [{ ...createDefaultProviderProfile(), modelPresets: roleModelMap, updatedAt: nowIso }];

  const enabledProfiles = providerProfiles.filter((profile) => profile.enabled);
  const fallbackProfileId = (enabledProfiles[0] ?? providerProfiles[0]).id;

  const roleModelSelections = {};
  for (const role of roleOrder) {
    const candidate = nextSettings.roleModelSelections?.[role];
    const legacyModel = roleModelMap[role] || defaultSettings.roleModelMap[role];
    const profileExists = candidate?.profileId && providerProfiles.some((profile) => profile.id === candidate.profileId);
    roleModelSelections[role] = {
      profileId: profileExists ? candidate.profileId : fallbackProfileId,
      model: typeof candidate?.model === "string" && candidate.model.trim() ? candidate.model.trim() : legacyModel
    };
  }

  return {
    ...defaultSettings,
    ...nextSettings,
    roleModelMap,
    providerProfiles,
    roleModelSelections
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
