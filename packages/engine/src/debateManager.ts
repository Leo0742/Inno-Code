import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ApplyRunResult,
  DebateConfig,
  DebateMessage,
  DebateRunInput,
  PlanRunResult,
  RuntimeClient,
  RuntimeEvent,
  ValidationResult
} from "./types.js";

const execFileAsync = promisify(execFile);

function buildContext(messages: DebateMessage[]): string {
  return messages.map((m) => `[${m.role}/${m.phase}] ${m.content}`).join("\n\n");
}

function formatValidationReport(results: ValidationResult[]): string {
  return results
    .map((r) => `Command: ${r.command}\nExit Code: ${r.exitCode}\nOutput:\n${r.output || "(no output)"}`)
    .join("\n\n---\n\n");
}

export class DebateManager {
  constructor(private runtime: RuntimeClient) {}

  async runPlanning(input: DebateRunInput): Promise<PlanRunResult> {
    const messages: DebateMessage[] = [];

    for (let round = 1; round <= input.config.rounds; round += 1) {
      const phase = round === 1 ? "proposal" : round === 2 ? "critique" : "revision";
      for (const role of ["architect", "critic", "implementer"] as const) {
        const model = input.config.roleModelMap[role];
        const prompt = this.buildRolePrompt(role, phase, input.task, buildContext(messages));
        const out = await this.runtime.runTurn({
          projectPath: input.projectPath,
          model,
          prompt,
          permissionMode: "plan",
          onEvent: input.onLog
        });
        messages.push({ role, phase, round, model, content: out.output });
      }
    }

    const judgeModel = input.config.roleModelMap.judge;
    const judgeOut = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: judgeModel,
      prompt: `Task: ${input.task}\n\nDebate:\n${buildContext(messages)}\n\nReturn:\n1) Final implementation plan\n2) Risks\n3) Explicit apply checklist`,
      permissionMode: "plan",
      onEvent: input.onLog
    });
    messages.push({ role: "judge", round: input.config.rounds + 1, phase: "verdict", model: judgeModel, content: judgeOut.output });

    const proposedDiffOut = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: input.config.roleModelMap.implementer,
      permissionMode: "plan",
      onEvent: input.onLog,
      prompt: `Generate a proposed unified diff for this task without applying changes.\nTask: ${input.task}\n\nFinal plan:\n${judgeOut.output}`
    });

    return {
      messages,
      finalPlan: judgeOut.output,
      proposedDiff: proposedDiffOut.output || "No proposed diff generated.",
      approvalRequired: input.config.approvalRequiredForApply
    };
  }

  async applyApprovedPlan(input: DebateRunInput & { finalPlan: string; approved: boolean }): Promise<ApplyRunResult> {
    const messages: DebateMessage[] = [];

    if (input.config.approvalRequiredForApply && !input.approved) {
      return {
        messages,
        validationReport: "Apply blocked: explicit approval is required.",
        validationResults: [],
        diff: "No diff generated.",
        applied: false
      };
    }

    const implementerModel = input.config.roleModelMap.implementer;
    const applyResult = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: implementerModel,
      permissionMode: "acceptEdits",
      onEvent: input.onLog,
      prompt: `Apply this approved plan exactly, then stop.\n\nTask:\n${input.task}\n\nApproved plan:\n${input.finalPlan}`
    });
    messages.push({ role: "implementer", round: 1, phase: "revision", model: implementerModel, content: applyResult.output });

    const validationResults = await this.runValidationCommands(input.projectPath, input.config, input.onLog);

    for (let attempt = 0; attempt < input.config.repairAttempts; attempt += 1) {
      if (validationResults.every((result) => result.exitCode === 0)) break;

      const verifierSummary = formatValidationReport(validationResults);
      input.onLog?.({ type: "validation_event", message: `Validation failed, repair attempt ${attempt + 1}`, raw: verifierSummary });

      const repair = await this.runtime.runTurn({
        projectPath: input.projectPath,
        model: implementerModel,
        permissionMode: "acceptEdits",
        prompt: `Fix only failing validations from this report and avoid unrelated edits.\n\n${verifierSummary}`,
        onEvent: input.onLog
      });
      messages.push({ role: "implementer", round: 2 + attempt, phase: "repair", model: implementerModel, content: repair.output });

      const rerun = await this.runValidationCommands(input.projectPath, input.config, input.onLog);
      validationResults.splice(0, validationResults.length, ...rerun);
    }

    const validationReport = formatValidationReport(validationResults);
    const diff = await this.collectDiff(input.projectPath);

    return {
      messages,
      validationReport,
      validationResults,
      diff,
      applied: true
    };
  }

  private async runValidationCommands(projectPath: string, config: DebateConfig, onLog?: (event: RuntimeEvent) => void): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    for (const command of config.validationCommands) {
      const commandResult = await execFileAsync("bash", ["-lc", command], {
        cwd: projectPath,
        maxBuffer: 10 * 1024 * 1024
      }).then(
        ({ stdout, stderr }) => ({ exitCode: 0, output: `${stdout}${stderr}`.trim() }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          exitCode: typeof error.code === "number" ? error.code : 1,
          output: `${error.stdout || ""}${error.stderr || ""}`.trim()
        })
      );

      const result: ValidationResult = {
        command,
        exitCode: commandResult.exitCode,
        output: commandResult.output
      };
      results.push(result);
      onLog?.({
        type: "validation_event",
        message: `${command} exited with ${result.exitCode}`,
        raw: JSON.stringify(result)
      });
    }

    return results;
  }

  private buildRolePrompt(role: "architect" | "critic" | "implementer", phase: string, task: string, context: string): string {
    return `You are ${role} in a multi-agent coding debate.\nPhase: ${phase}.\nTask: ${task}.\n\nContext from prior messages:\n${context || "(none)"}\n\nRules:\n- Do not edit files directly in planning mode.\n- Use concrete file paths and command-level reasoning.`;
  }

  private async collectDiff(projectPath: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "diff", "--", "."], { maxBuffer: 10 * 1024 * 1024 });
    return stdout || "No diff generated.";
  }
}
