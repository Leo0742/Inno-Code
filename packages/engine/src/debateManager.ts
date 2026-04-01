import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { DebateMessage, DebateRunInput, DebateRunResult, RuntimeClient, RuntimeTurnResult } from "./types.js";

const execFileAsync = promisify(execFile);

function buildContext(messages: DebateMessage[]): string {
  return messages.map((m) => `[${m.role}/${m.phase}] ${m.content}`).join("\n\n");
}

function looksLikeValidationFailure(report: string): boolean {
  return /(failed|error|not found|exception)/i.test(report);
}

export class DebateManager {
  constructor(private runtime: RuntimeClient) {}

  async run(input: DebateRunInput): Promise<DebateRunResult> {
    const messages: DebateMessage[] = [];

    for (let round = 1; round <= input.config.rounds; round += 1) {
      const phase = round === 1 ? "proposal" : round === 2 ? "critique" : "revision";
      for (const role of ["architect", "critic", "implementer"] as const) {
        const model = input.config.roleModelMap[role];
        const prompt = this.buildRolePrompt(role, phase, input.task, buildContext(messages));
        input.onLog?.(`Running ${role} (${phase}) with model ${model}`);
        const out = await this.runtime.runTurn({
          projectPath: input.projectPath,
          model,
          prompt,
          permissionMode: role === "implementer" ? "acceptEdits" : "default",
          onEvent: input.onLog
        });
        messages.push({ role, phase, round, model, content: out.output });
      }
    }

    const judgeModel = input.config.roleModelMap.judge;
    const judgeOut = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: judgeModel,
      prompt: `Task: ${input.task}\n\nDebate:\n${buildContext(messages)}\n\nPick the strongest solution, explain why, and produce an execution checklist.`,
      permissionMode: "default",
      onEvent: input.onLog
    });
    messages.push({ role: "judge", round: input.config.rounds + 1, phase: "verdict", model: judgeModel, content: judgeOut.output });

    const validationReport = await this.runValidation(input, messages, judgeOut.output);
    const diff = await this.collectDiff(input.projectPath);

    return {
      messages,
      finalPlan: judgeOut.output,
      validationReport,
      diff
    };
  }

  private async runValidation(input: DebateRunInput, messages: DebateMessage[], finalPlan: string): Promise<string> {
    const verifierModel = input.config.roleModelMap.verifier;
    let report = "";

    for (let attempt = 0; attempt <= input.config.repairAttempts; attempt += 1) {
      const validationPrompt = `Validate the applied changes for task: ${input.task}\nRun these commands and summarize output:\n${input.config.validationCommands.map((c) => `- ${c}`).join("\n")}\n\nFinal plan:\n${finalPlan}`;
      const validationOut = await this.runtime.runTurn({
        projectPath: input.projectPath,
        model: verifierModel,
        prompt: validationPrompt,
        permissionMode: "acceptEdits",
        onEvent: input.onLog
      });
      report = validationOut.output;
      messages.push({ role: "verifier", round: 100 + attempt, phase: "validation", model: verifierModel, content: report });

      if (!looksLikeValidationFailure(report) || attempt === input.config.repairAttempts) {
        break;
      }

      input.onLog?.(`Validation failed, running repair attempt ${attempt + 1}`);
      const implementerModel = input.config.roleModelMap.implementer;
      const repair = await this.runtime.runTurn({
        projectPath: input.projectPath,
        model: implementerModel,
        permissionMode: "acceptEdits",
        prompt: `Validation failed. Fix only reported issues and re-run minimal checks.\nReport:\n${report}\n\nTask:\n${input.task}`,
        onEvent: input.onLog
      });
      messages.push({ role: "implementer", round: 200 + attempt, phase: "repair", model: implementerModel, content: repair.output });
    }

    return report;
  }

  private buildRolePrompt(role: "architect" | "critic" | "implementer", phase: string, task: string, context: string): string {
    return `You are ${role} in a multi-agent coding debate.\nPhase: ${phase}.\nTask: ${task}.\n\nContext from prior messages:\n${context || "(none)"}\n\nRules:\n- Use concrete file paths and commands where relevant.\n- If role is implementer during revision, apply code changes directly in repository.`;
  }

  private async collectDiff(projectPath: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "diff", "--", "."], { maxBuffer: 10 * 1024 * 1024 });
    return stdout || "No diff generated.";
  }
}

export class OpenClaudeCliRuntime implements RuntimeClient {
  async runTurn(input: {
    projectPath: string;
    model: string;
    prompt: string;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
    onEvent?: (event: string) => void;
  }): Promise<RuntimeTurnResult> {
    const args = [
      "-y",
      "@gitlawb/openclaude",
      "-p",
      input.prompt,
      "--print",
      "--output-format",
      "stream-json",
      "--permission-mode",
      input.permissionMode ?? "default",
      "--model",
      input.model,
      "--add-dir",
      input.projectPath
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("npx", args, { cwd: input.projectPath, env: process.env });
      let buffer = "";
      const rawEvents: string[] = [];
      const outputs: string[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          rawEvents.push(line);
          input.onEvent?.(line);
          try {
            const evt = JSON.parse(line);
            const text = this.extractText(evt);
            if (text) outputs.push(text);
          } catch {
            outputs.push(line);
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => input.onEvent?.(chunk.toString()));
      child.on("error", reject);
      child.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`openclaude exited with code ${code}`));
          return;
        }
        resolve({ output: outputs.join("\n").trim(), rawEvents });
      });
    });
  }

  private extractText(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((v) => this.extractText(v)).filter(Boolean).join(" ");
    if (!value || typeof value !== "object") return "";
    const obj = value as Record<string, unknown>;
    const priority = ["text", "content", "message", "result", "output", "summary"];
    for (const key of priority) {
      const t = this.extractText(obj[key]);
      if (t) return t;
    }
    return "";
  }
}
