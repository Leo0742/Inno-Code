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
    runPlan: (payload: { task: string; projectPath: string }) => Promise<{
      streamId: string;
      sessionId: string;
      messages: Array<{ role: string; phase: string; round: number; model: string; content: string }>;
      finalPlan: string;
      proposedDiff: string;
      predictedChangedFiles: string[];
      implementationChecklist: string[];
      approvalRequired: boolean;
      logs: string[];
      status: string;
    }>;
    applyPlan: (payload: { sessionId: string; approved: boolean }) => Promise<{
      streamId: string;
      messages: Array<{ role: string; phase: string; round: number; model: string; content: string }>;
      validationReport: string;
      validationResults: Array<{ command: string; exitCode: number; output: string }>;
      diff: string;
      applied: boolean;
      logs: string[];
      status: string;
    }>;
    discardPlan: (payload: { sessionId: string }) => Promise<{ ok: true }>;
    onRuntimeEvent: (handler: (payload: RuntimeEventPayload) => void) => () => void;
  };
}
