import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AgentRole,
  ApplyRunResult,
  DebateConfig,
  DebateMessage,
  DebateRunInput,
  DebatePhase,
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

function parsePredictedChangedFiles(proposedDiff: string): string[] {
  return Array.from(new Set(Array.from(proposedDiff.matchAll(/^\+\+\+ b\/(.+)$/gm)).map((match) => match[1].trim())));
}

function parseChecklist(finalPlan: string): string[] {
  return finalPlan
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(-|\*|\d+\.|\[ \]|\[x\])/i.test(line))
    .slice(0, 12);
}

function emitPhase(onLog: ((event: RuntimeEvent) => void) | undefined, phase: DebatePhase, message: string, role?: AgentRole) {
  onLog?.({ type: "phase_event", phase, role, message, raw: message });
}

export class DebateManager {
  constructor(private runtime: RuntimeClient) {}

  async runPlanning(input: DebateRunInput): Promise<PlanRunResult> {
    const messages: DebateMessage[] = [];
    emitPhase(input.onLog, "proposal", "Planning started");

    for (let round = 1; round <= input.config.rounds; round += 1) {
      const phase: DebatePhase = round === 1 ? "proposal" : round === 2 ? "critique" : "revision";
      for (const role of ["architect", "critic", "implementer"] as const) {
        const model = input.config.roleModelMap[role];
        emitPhase(input.onLog, phase, `${role} started (${phase})`, role);
        const prompt = this.buildRolePrompt(role, phase, input.task, buildContext(messages));
        const out = await this.runtime.runTurn({
          projectPath: input.projectPath,
          model,
          prompt,
          permissionMode: "plan",
          onEvent: input.onLog
        });
        messages.push({ role, phase, round, model, content: out.output });
        emitPhase(input.onLog, phase, `${role} finished (${phase})`, role);
      }
    }

    const judgeModel = input.config.roleModelMap.judge;
    emitPhase(input.onLog, "verdict", "judge started (verdict)", "judge");
    const judgeOut = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: judgeModel,
      prompt: `Task: ${input.task}\n\nDebate:\n${buildContext(messages)}\n\nReturn:\n1) Final implementation plan\n2) Risks\n3) Explicit apply checklist`,
      permissionMode: "plan",
      onEvent: input.onLog
    });
    messages.push({ role: "judge", round: input.config.rounds + 1, phase: "verdict", model: judgeModel, content: judgeOut.output });
    emitPhase(input.onLog, "verdict", "judge finished (verdict)", "judge");

    emitPhase(input.onLog, "revision", "implementer started (predicted patch)", "implementer");
    const proposedDiffOut = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: input.config.roleModelMap.implementer,
      permissionMode: "plan",
      onEvent: input.onLog,
      prompt: `Generate a proposed unified diff for this task without applying changes.\nTask: ${input.task}\n\nFinal plan:\n${judgeOut.output}`
    });
    emitPhase(input.onLog, "revision", "implementer finished (predicted patch)", "implementer");

    const proposedDiff = proposedDiffOut.output || "No proposed diff generated.";

    return {
      messages,
      finalPlan: judgeOut.output,
      proposedDiff,
      predictedChangedFiles: parsePredictedChangedFiles(proposedDiff),
      implementationChecklist: parseChecklist(judgeOut.output),
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
    emitPhase(input.onLog, "revision", "implementer started (apply)", "implementer");
    const applyResult = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: implementerModel,
      permissionMode: "acceptEdits",
      onEvent: input.onLog,
      prompt: `Apply this approved plan exactly, then stop.\n\nTask:\n${input.task}\n\nApproved plan:\n${input.finalPlan}`
    });
    messages.push({ role: "implementer", round: 1, phase: "revision", model: implementerModel, content: applyResult.output });
    emitPhase(input.onLog, "revision", "implementer finished (apply)", "implementer");

    emitPhase(input.onLog, "validation", "validation started");
    const validationResults = await this.runValidationCommands(input.projectPath, input.config, input.onLog);

    for (let attempt = 0; attempt < input.config.repairAttempts; attempt += 1) {
      if (validationResults.every((result) => result.exitCode === 0)) break;

      const verifierSummary = formatValidationReport(validationResults);
      input.onLog?.({ type: "validation_event", phase: "validation", message: `Validation failed, repair attempt ${attempt + 1}`, raw: verifierSummary });

      emitPhase(input.onLog, "repair", `implementer started (repair ${attempt + 1})`, "implementer");
      const repair = await this.runtime.runTurn({
        projectPath: input.projectPath,
        model: implementerModel,
        permissionMode: "acceptEdits",
        prompt: `Fix only failing validations from this report and avoid unrelated edits.\n\n${verifierSummary}`,
        onEvent: input.onLog
      });
      messages.push({ role: "implementer", round: 2 + attempt, phase: "repair", model: implementerModel, content: repair.output });
      emitPhase(input.onLog, "repair", `implementer finished (repair ${attempt + 1})`, "implementer");

      emitPhase(input.onLog, "validation", "validation rerun started");
      const rerun = await this.runValidationCommands(input.projectPath, input.config, input.onLog);
      validationResults.splice(0, validationResults.length, ...rerun);
    }

    const commandReport = formatValidationReport(validationResults);
    const verifierReport = await this.summarizeValidationWithVerifier(input, commandReport, messages);
    const validationReport = verifierReport ? `${commandReport}\n\n=== Verifier Summary (${input.config.roleModelMap.verifier}) ===\n${verifierReport}` : commandReport;
    emitPhase(input.onLog, "validation", "validation completed");

    const diff = await this.collectDiff(input.projectPath);

    return {
      messages,
      validationReport,
      validationResults,
      diff,
      applied: true
    };
  }

  private async summarizeValidationWithVerifier(
    input: DebateRunInput & { finalPlan: string; approved: boolean },
    commandReport: string,
    messages: DebateMessage[]
  ): Promise<string> {
    const verifierModel = input.config.roleModelMap.verifier;
    if (!verifierModel) return "";

    emitPhase(input.onLog, "validation", "verifier started (summary)", "verifier");
    const verifierResult = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: verifierModel,
      permissionMode: "plan",
      onEvent: input.onLog,
      prompt:
        `You are verifier. Summarize validation results for the user.\n` +
        `State overall status (PASS/FAIL), list failing commands, and recommend next action in <= 8 bullets.\n\n` +
        `Validation report:\n${commandReport}`
    });
    emitPhase(input.onLog, "validation", "verifier finished (summary)", "verifier");

    messages.push({ role: "verifier", round: messages.length + 1, phase: "validation", model: verifierModel, content: verifierResult.output });
    return verifierResult.output;
  }

  private async runValidationCommands(projectPath: string, config: DebateConfig, onLog?: (event: RuntimeEvent) => void): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    for (const command of config.validationCommands) {
      onLog?.({ type: "command_event", phase: "validation", message: `Running validation command: ${command}`, raw: command });
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
        phase: "validation",
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
