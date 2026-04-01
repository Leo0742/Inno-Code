export type AgentRole = "architect" | "critic" | "implementer" | "judge" | "verifier";

export type DebatePhase = "proposal" | "critique" | "revision" | "verdict" | "validation" | "repair";

export interface DebateMessage {
  role: AgentRole;
  round: number;
  phase: DebatePhase;
  model: string;
  content: string;
}

export interface DebateConfig {
  rounds: number;
  roleModelMap: Record<AgentRole, string>;
  validationCommands: string[];
  repairAttempts: number;
  approvalRequiredForApply: boolean;
}

export interface RuntimeEvent {
  type:
    | "phase_event"
    | "agent_started"
    | "agent_finished"
    | "tool_event"
    | "command_event"
    | "validation_event"
    | "diff_event"
    | "error_event"
    | "raw";
  message: string;
  raw: string;
  phase?: DebatePhase;
  role?: AgentRole;
}

export interface RuntimeTurnResult {
  output: string;
  rawEvents: string[];
  events: RuntimeEvent[];
  exitCode: number;
}

export interface RuntimeClient {
  runTurn(input: {
    projectPath: string;
    model: string;
    prompt: string;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
    onEvent?: (event: RuntimeEvent) => void;
    signal?: AbortSignal;
  }): Promise<RuntimeTurnResult>;
}

export interface DebateRunInput {
  task: string;
  projectPath: string;
  config: DebateConfig;
  onLog?: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
}

export interface PlanRunResult {
  messages: DebateMessage[];
  finalPlan: string;
  proposedDiff: string;
  predictedChangedFiles: string[];
  implementationChecklist: string[];
  approvalRequired: boolean;
}

export interface ValidationResult {
  command: string;
  exitCode: number;
  output: string;
}

export interface ApplyRunResult {
  messages: DebateMessage[];
  validationReport: string;
  validationResults: ValidationResult[];
  diff: string;
  applied: boolean;
}
