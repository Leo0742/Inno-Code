interface ProviderProfile {
  id: string;
  displayName: string;
  providerType: "openai_compatible" | "anthropic_compatible" | "custom_openai" | "local_runtime";
  endpoint: string;
  credentialRef: string;
  organization: string;
  project: string;
  extraHeaders: Record<string, string>;
  modelPresets: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RoleModelSelection {
  profileId: string;
  model: string;
}

interface RuntimeEventPayload {
  streamId: string;
  ts: number;
  event: { type: string; message: string; raw: string; phase?: string; role?: string };
}

interface AppSettingsShape {
  rounds: number;
  repairAttempts: number;
  approvalRequiredForApply: boolean;
  validationCommands: string[];
  roleModelMap: Record<string, string>;
  providerProfiles: ProviderProfile[];
  roleModelSelections: Record<string, RoleModelSelection>;
}

interface PendingPlanSession {
  sessionId: string;
  task: string;
  projectPath: string;
  finalPlan: string;
  settings: AppSettingsShape;
  proposedDiff?: string;
  predictedChangedFiles?: string[];
  implementationChecklist?: string[];
  exactPreview?: {
    exactPreviewAvailable: boolean;
    previewMode: "exact" | "predicted";
    reason?: string;
    sandboxPath?: string;
    sandboxKind?: "worktree" | "copy";
    changedFiles: string[];
    diff: string;
    validationReport: string;
    unsupportedFiles?: Array<{ filePath: string; reason: string }>;
    createdAt?: string;
  } | null;
  createdAt?: string;
}

interface Window {
  innoCode: {
    version: string;
    pickProject: () => Promise<string>;
    getSettings: () => Promise<AppSettingsShape>;
    saveSettings: (settings: AppSettingsShape) => Promise<AppSettingsShape>;
    setCredential: (payload: { credentialRef: string; secret: string }) => Promise<{ ok: boolean }>;
    deleteCredential: (payload: { credentialRef: string }) => Promise<void>;
    getCredentialStatus: (payload: { credentialRef: string }) => Promise<{ hasCredential: boolean }>;
    testProvider: (payload: { settings: AppSettingsShape; role?: string }) => Promise<{ ok: boolean; category: string; message: string }>;
    getPendingPlans: () => Promise<PendingPlanSession[]>;
    getRuntimeDiagnostics: () => Promise<any>;
    runPlan: (payload: { task: string; projectPath: string; streamId: string }) => Promise<any>;
    generateExactPreview: (payload: { sessionId: string; streamId: string }) => Promise<any>;
    applyPlan: (payload: any) => Promise<any>;
    cancelRun: (payload: { streamId: string }) => Promise<{ ok: boolean; message: string }>;
    discardPlan: (payload: { sessionId: string }) => Promise<{ ok: true }>;
    onRuntimeEvent: (handler: (payload: RuntimeEventPayload) => void) => () => void;
  };
}
