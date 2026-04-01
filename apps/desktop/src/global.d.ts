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
    applyPlan: (payload: { sessionId: string; approved: boolean; streamId: string }) => Promise<{
      streamId: string;
      messages: Array<{ role: string; phase: string; round: number; model: string; content: string }>;
      validationReport: string;
      validationResults: Array<{ command: string; exitCode: number; output: string }>;
      diff: string;
      applied: boolean;
      status: string;
    }>;
    cancelRun: (payload: { streamId: string }) => Promise<{ ok: boolean; message: string }>;
    discardPlan: (payload: { sessionId: string }) => Promise<{ ok: true }>;
    onRuntimeEvent: (handler: (payload: RuntimeEventPayload) => void) => () => void;
  };
}
