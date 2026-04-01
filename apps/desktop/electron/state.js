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

export function createPendingPlanStore() {
  const pendingPlans = new Map();

  return {
    set(sessionId, value) {
      pendingPlans.set(sessionId, value);
    },
    get(sessionId) {
      return pendingPlans.get(sessionId);
    },
    delete(sessionId) {
      pendingPlans.delete(sessionId);
    },
    size() {
      return pendingPlans.size;
    }
  };
}
