export type AgentRole = "architect" | "critic" | "implementer" | "judge" | "verifier";

export interface DebateMessage {
  role: AgentRole;
  round: number;
  phase: "proposal" | "critique" | "revision" | "verdict" | "validation" | "repair";
  model: string;
  content: string;
}

export interface DebateConfig {
  rounds: number;
  roleModelMap: Record<AgentRole, string>;
  validationCommands: string[];
  repairAttempts: number;
}

export interface RuntimeTurnResult {
  output: string;
  rawEvents: string[];
}

export interface RuntimeClient {
  runTurn(input: {
    projectPath: string;
    model: string;
    prompt: string;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
    onEvent?: (event: string) => void;
  }): Promise<RuntimeTurnResult>;
}

export interface DebateRunInput {
  task: string;
  projectPath: string;
  config: DebateConfig;
  onLog?: (line: string) => void;
}

export interface DebateRunResult {
  messages: DebateMessage[];
  finalPlan: string;
  validationReport: string;
  diff: string;
}
