interface RuntimeEventPayload {
  streamId: string;
  ts: number;
  event: {
    type: string;
    message: string;
    raw: string;
    phase?: string;
    role?: string;
  };
}

interface PendingPlanSession {
  sessionId: string;
  task: string;
  projectPath: string;
  finalPlan: string;
  settings: {
    rounds: number;
    repairAttempts: number;
    approvalRequiredForApply: boolean;
    validationCommands: string[];
    roleModelMap: Record<string, string>;
  };
  proposedDiff?: string;
  predictedChangedFiles?: string[];
  implementationChecklist?: string[];
  exactPreview?: {
    exactPreviewAvailable: boolean;
    previewMode: "exact" | "predicted";
    reason?: string;
    sandboxPath?: string;
    changedFiles: string[];
    diff: string;
    validationReport: string;
    createdAt?: string;
  } | null;
  createdAt?: string;
}

interface Window {
  innoCode: {
    version: string;
    pickProject: () => Promise<string>;
    getSettings: () => Promise<{
      rounds: number;
      repairAttempts: number;
      approvalRequiredForApply: boolean;
      validationCommands: string[];
      roleModelMap: Record<string, string>;
    }>;
    saveSettings: (settings: {
      rounds: number;
      repairAttempts: number;
      approvalRequiredForApply: boolean;
      validationCommands: string[];
      roleModelMap: Record<string, string>;
    }) => Promise<{
      rounds: number;
      repairAttempts: number;
      approvalRequiredForApply: boolean;
      validationCommands: string[];
      roleModelMap: Record<string, string>;
    }>;
    getPendingPlans: () => Promise<PendingPlanSession[]>;
    getRuntimeDiagnostics: () => Promise<{
      openClaudeCliAvailable: boolean;
      openClaudeVersion: string;
      providerConfigurationOwner: "openclaude_runtime";
      guidance: string[];
      lastRuntimeFailure: null | { at: string; message: string };
    }>;
    runPlan: (payload: { task: string; projectPath: string; streamId: string }) => Promise<{
      streamId: string;
      sessionId: string;
      messages: Array<{ role: string; phase: string; round: number; model: string; content: string }>;
      finalPlan: string;
      proposedDiff: string;
      predictedChangedFiles: string[];
      implementationChecklist: string[];
      approvalRequired: boolean;
      status: string;
    }>;
    generateExactPreview: (payload: { sessionId: string; streamId: string }) => Promise<{
      streamId: string;
      exactPreviewAvailable: boolean;
      previewMode: "exact" | "predicted";
      reason?: string;
      sandboxPath?: string;
      changedFiles: string[];
      diff: string;
      validationReport: string;
      validationResults: Array<{ command: string; exitCode: number; output: string }>;
    }>;
    applyPlan: (payload: {
      sessionId: string;
      approved: boolean;
      streamId: string;
      applyMode?: "runtime_full" | "exact_all" | "exact_selected";
      selectedFiles?: string[];
    }) => Promise<{
      streamId: string;
      messages: Array<{ role: string; phase: string; round: number; model: string; content: string }>;
      validationReport: string;
      validationResults: Array<{ command: string; exitCode: number; output: string }>;
      diff: string;
      changedFiles: string[];
      applyMode: "runtime_full" | "exact_all" | "exact_selected";
      applied: boolean;
      status: string;
    }>;
    cancelRun: (payload: { streamId: string }) => Promise<{ ok: boolean; message: string }>;
    discardPlan: (payload: { sessionId: string }) => Promise<{ ok: true }>;
    onRuntimeEvent: (handler: (payload: RuntimeEventPayload) => void) => () => void;
  };
}
