interface Window {
  innoCode: {
    version: string;
    pickProject: () => Promise<string>;
    runDebate: (payload: {
      task: string;
      projectPath: string;
      roleModelMap: Record<string, string>;
      validationCommands: string[];
    }) => Promise<{
      messages: Array<{ role: string; phase: string; round: number; model: string; content: string }>;
      finalPlan: string;
      validationReport: string;
      diff: string;
      logs: string[];
    }>;
  };
}
