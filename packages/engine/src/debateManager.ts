import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AbortRunError, isAbortError } from "./runtime.js";
import type {
  AgentRole,
  ApplyRunResult,
  DebateConfig,
  DebateMessage,
  DebateRunInput,
  DebatePhase,
  ExactPreviewResult,
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

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AbortRunError();
  }
}

export class DebateManager {
  constructor(private runtime: RuntimeClient) {}

  async runPlanning(input: DebateRunInput): Promise<PlanRunResult> {
    throwIfAborted(input.signal);
    const messages: DebateMessage[] = [];
    emitPhase(input.onLog, "proposal", "Planning started");

    for (let round = 1; round <= input.config.rounds; round += 1) {
      throwIfAborted(input.signal);
      const phase: DebatePhase = round === 1 ? "proposal" : round === 2 ? "critique" : "revision";
      for (const role of ["architect", "critic", "implementer"] as const) {
        throwIfAborted(input.signal);
        const model = input.config.roleModelMap[role];
        emitPhase(input.onLog, phase, `${role} started (${phase})`, role);
        const prompt = this.buildRolePrompt(role, phase, input.task, buildContext(messages));
        const out = await this.runtime.runTurn({
          projectPath: input.projectPath,
          model,
          prompt,
          permissionMode: "plan",
          onEvent: input.onLog,
          signal: input.signal
        });
        messages.push({ role, phase, round, model, content: out.output });
        emitPhase(input.onLog, phase, `${role} finished (${phase})`, role);
      }
    }

    throwIfAborted(input.signal);
    const judgeModel = input.config.roleModelMap.judge;
    emitPhase(input.onLog, "verdict", "judge started (verdict)", "judge");
    const judgeOut = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: judgeModel,
      prompt: `Task: ${input.task}\n\nDebate:\n${buildContext(messages)}\n\nReturn:\n1) Final implementation plan\n2) Risks\n3) Explicit apply checklist`,
      permissionMode: "plan",
      onEvent: input.onLog,
      signal: input.signal
    });
    messages.push({ role: "judge", round: input.config.rounds + 1, phase: "verdict", model: judgeModel, content: judgeOut.output });
    emitPhase(input.onLog, "verdict", "judge finished (verdict)", "judge");

    emitPhase(input.onLog, "revision", "implementer started (predicted patch)", "implementer");
    const proposedDiffOut = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: input.config.roleModelMap.implementer,
      permissionMode: "plan",
      onEvent: input.onLog,
      signal: input.signal,
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
    throwIfAborted(input.signal);
    const messages: DebateMessage[] = [];

    if (input.config.approvalRequiredForApply && !input.approved) {
      return {
        messages,
        validationReport: "Apply blocked: explicit approval is required.",
        validationResults: [],
        diff: "No diff generated.",
        applied: false,
        applyMode: "runtime_full",
        changedFiles: []
      };
    }

    const implementerModel = input.config.roleModelMap.implementer;
    emitPhase(input.onLog, "revision", "implementer started (apply)", "implementer");
    const applyResult = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: implementerModel,
      permissionMode: "acceptEdits",
      onEvent: input.onLog,
      signal: input.signal,
      prompt: `Apply this approved plan exactly, then stop.\n\nTask:\n${input.task}\n\nApproved plan:\n${input.finalPlan}`
    });
    messages.push({ role: "implementer", round: 1, phase: "revision", model: implementerModel, content: applyResult.output });
    emitPhase(input.onLog, "revision", "implementer finished (apply)", "implementer");

    emitPhase(input.onLog, "validation", "validation started");
    const validationResults = await this.runValidationCommands(input.projectPath, input.config, input.onLog, input.signal);

    for (let attempt = 0; attempt < input.config.repairAttempts; attempt += 1) {
      throwIfAborted(input.signal);
      if (validationResults.every((result) => result.exitCode === 0)) break;

      const verifierSummary = formatValidationReport(validationResults);
      input.onLog?.({ type: "validation_event", phase: "validation", message: `Validation failed, repair attempt ${attempt + 1}`, raw: verifierSummary });

      emitPhase(input.onLog, "repair", `implementer started (repair ${attempt + 1})`, "implementer");
      const repair = await this.runtime.runTurn({
        projectPath: input.projectPath,
        model: implementerModel,
        permissionMode: "acceptEdits",
        prompt: `Fix only failing validations from this report and avoid unrelated edits.\n\n${verifierSummary}`,
        onEvent: input.onLog,
        signal: input.signal
      });
      messages.push({ role: "implementer", round: 2 + attempt, phase: "repair", model: implementerModel, content: repair.output });
      emitPhase(input.onLog, "repair", `implementer finished (repair ${attempt + 1})`, "implementer");

      emitPhase(input.onLog, "validation", "validation rerun started");
      const rerun = await this.runValidationCommands(input.projectPath, input.config, input.onLog, input.signal);
      validationResults.splice(0, validationResults.length, ...rerun);
    }

    const commandReport = formatValidationReport(validationResults);
    const verifierReport = await this.summarizeValidationWithVerifier(input, commandReport, messages);
    const validationReport = verifierReport ? `${commandReport}\n\n=== Verifier Summary (${input.config.roleModelMap.verifier}) ===\n${verifierReport}` : commandReport;
    emitPhase(input.onLog, "validation", "validation completed");

    const diff = await this.collectDiff(input.projectPath, input.signal);

    return {
      messages,
      validationReport,
      validationResults,
      diff,
      applied: true,
      applyMode: "runtime_full",
      changedFiles: await this.collectChangedFiles(input.projectPath, input.signal)
    };
  }

  async generateExactPreview(input: DebateRunInput & { finalPlan: string }): Promise<ExactPreviewResult> {
    throwIfAborted(input.signal);
    if (!(await this.isGitRepository(input.projectPath, input.signal))) {
      return this.createPredictedFallback("Exact preview unavailable: project is not a git repository.");
    }

    if (!(await this.isCleanWorkingTree(input.projectPath, input.signal))) {
      return this.createPredictedFallback(
        "Exact preview unavailable: working tree has uncommitted changes, which makes sandbox preview misleading."
      );
    }

    const sandboxPath = await fs.mkdtemp(path.join(os.tmpdir(), "inno-preview-"));
    let attached = false;
    try {
      await this.runGit(input.projectPath, ["worktree", "add", "--detach", sandboxPath, "HEAD"], input.signal);
      attached = true;
      const implementerModel = input.config.roleModelMap.implementer;
      emitPhase(input.onLog, "revision", "implementer started (exact preview sandbox)", "implementer");
      await this.runtime.runTurn({
        projectPath: sandboxPath,
        model: implementerModel,
        permissionMode: "acceptEdits",
        onEvent: input.onLog,
        signal: input.signal,
        prompt: `Apply this approved plan exactly, then stop.\n\nTask:\n${input.task}\n\nApproved plan:\n${input.finalPlan}`
      });
      emitPhase(input.onLog, "revision", "implementer finished (exact preview sandbox)", "implementer");

      const changedFiles = await this.collectChangedFiles(sandboxPath, input.signal);
      const diff = await this.collectDiff(sandboxPath, input.signal);
      const validationResults = await this.runValidationCommands(sandboxPath, input.config, input.onLog, input.signal);
      const validationReport = formatValidationReport(validationResults);

      return {
        exactPreviewAvailable: true,
        previewMode: "exact",
        sandboxPath,
        changedFiles,
        diff,
        validationReport,
        validationResults
      };
    } catch (error) {
      if (attached) {
        await this.cleanupWorktree(input.projectPath, sandboxPath);
      } else {
        await fs.rm(sandboxPath, { recursive: true, force: true });
      }
      if (isAbortError(error)) throw error;
      return this.createPredictedFallback(`Exact preview failed: ${(error as Error).message}`);
    }
  }

  async cleanupExactPreview(projectPath: string, sandboxPath: string): Promise<void> {
    await this.cleanupWorktree(projectPath, sandboxPath);
  }

  async applyFromExactPreviewArtifact(input: {
    projectPath: string;
    sandboxPath: string;
    selectedFiles?: string[];
    config: DebateConfig;
    onLog?: (event: RuntimeEvent) => void;
    signal?: AbortSignal;
  }): Promise<ApplyRunResult> {
    throwIfAborted(input.signal);
    const changedFiles = await this.collectChangedFiles(input.sandboxPath, input.signal);
    const fileSet = new Set(changedFiles);
    const selected = input.selectedFiles?.length ? input.selectedFiles.filter((file) => fileSet.has(file)) : changedFiles;
    if (!selected.length) {
      return {
        messages: [],
        validationReport: "Apply blocked: no selectable files found in exact preview artifact.",
        validationResults: [],
        diff: "No diff generated.",
        applied: false,
        applyMode: input.selectedFiles?.length ? "exact_selected" : "exact_all",
        changedFiles: []
      };
    }

    const statusMap = await this.collectNameStatus(input.sandboxPath, input.signal);
    for (const filePath of selected) {
      throwIfAborted(input.signal);
      const sourcePath = path.join(input.sandboxPath, filePath);
      const targetPath = path.join(input.projectPath, filePath);
      if (statusMap.get(filePath) === "D") {
        await fs.rm(targetPath, { force: true });
        continue;
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }

    emitPhase(input.onLog, "validation", "validation started");
    const validationResults = await this.runValidationCommands(input.projectPath, input.config, input.onLog, input.signal);
    emitPhase(input.onLog, "validation", "validation completed");
    return {
      messages: [],
      validationReport: formatValidationReport(validationResults),
      validationResults,
      diff: await this.collectDiff(input.projectPath, input.signal),
      applied: true,
      applyMode: input.selectedFiles?.length ? "exact_selected" : "exact_all",
      changedFiles: selected
    };
  }

  private async summarizeValidationWithVerifier(
    input: DebateRunInput & { finalPlan: string; approved: boolean },
    commandReport: string,
    messages: DebateMessage[]
  ): Promise<string> {
    throwIfAborted(input.signal);
    const verifierModel = input.config.roleModelMap.verifier;
    if (!verifierModel) return "";

    emitPhase(input.onLog, "validation", "verifier started (summary)", "verifier");
    const verifierResult = await this.runtime.runTurn({
      projectPath: input.projectPath,
      model: verifierModel,
      permissionMode: "plan",
      onEvent: input.onLog,
      signal: input.signal,
      prompt:
        `You are verifier. Summarize validation results for the user.\n` +
        `State overall status (PASS/FAIL), list failing commands, and recommend next action in <= 8 bullets.\n\n` +
        `Validation report:\n${commandReport}`
    });
    emitPhase(input.onLog, "validation", "verifier finished (summary)", "verifier");

    messages.push({ role: "verifier", round: messages.length + 1, phase: "validation", model: verifierModel, content: verifierResult.output });
    return verifierResult.output;
  }

  private async runValidationCommands(
    projectPath: string,
    config: DebateConfig,
    onLog?: (event: RuntimeEvent) => void,
    signal?: AbortSignal
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    for (const command of config.validationCommands) {
      throwIfAborted(signal);
      onLog?.({ type: "command_event", phase: "validation", message: `Running validation command: ${command}`, raw: command });
      const commandResult = await execFileAsync("bash", ["-lc", command], {
        cwd: projectPath,
        maxBuffer: 10 * 1024 * 1024,
        signal
      }).then(
        ({ stdout, stderr }) => ({ exitCode: 0, output: `${stdout}${stderr}`.trim() }),
        (error: { code?: number; stdout?: string; stderr?: string; message?: string; name?: string }) => {
          if (isAbortError(error)) {
            throw new AbortRunError();
          }
          return {
            exitCode: typeof error.code === "number" ? error.code : 1,
            output: `${error.stdout || ""}${error.stderr || ""}`.trim()
          };
        }
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

  private async collectDiff(projectPath: string, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "diff", "--", "."], {
      maxBuffer: 10 * 1024 * 1024,
      signal
    });
    return stdout || "No diff generated.";
  }

  private async collectChangedFiles(projectPath: string, signal?: AbortSignal): Promise<string[]> {
    throwIfAborted(signal);
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "diff", "--name-only", "--", "."], {
      maxBuffer: 10 * 1024 * 1024,
      signal
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async collectNameStatus(projectPath: string, signal?: AbortSignal): Promise<Map<string, string>> {
    throwIfAborted(signal);
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "diff", "--name-status", "--", "."], {
      maxBuffer: 10 * 1024 * 1024,
      signal
    });
    const map = new Map<string, string>();
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [status, filePath] = trimmed.split(/\s+/, 2);
      if (!status || !filePath) continue;
      map.set(filePath, status);
    }
    return map;
  }

  private async isGitRepository(projectPath: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await execFileAsync("git", ["-C", projectPath, "rev-parse", "--is-inside-work-tree"], {
        maxBuffer: 1024 * 1024,
        signal
      });
      return true;
    } catch {
      return false;
    }
  }

  private async isCleanWorkingTree(projectPath: string, signal?: AbortSignal): Promise<boolean> {
    const { stdout } = await execFileAsync("git", ["-C", projectPath, "status", "--porcelain"], {
      maxBuffer: 10 * 1024 * 1024,
      signal
    });
    return stdout.trim().length === 0;
  }

  private async runGit(projectPath: string, args: string[], signal?: AbortSignal): Promise<void> {
    await execFileAsync("git", ["-C", projectPath, ...args], {
      maxBuffer: 10 * 1024 * 1024,
      signal
    });
  }

  private async cleanupWorktree(projectPath: string, sandboxPath: string): Promise<void> {
    await execFileAsync("git", ["-C", projectPath, "worktree", "remove", "--force", sandboxPath], {
      maxBuffer: 10 * 1024 * 1024
    }).catch(async () => {
      await fs.rm(sandboxPath, { recursive: true, force: true });
    });
  }

  private createPredictedFallback(reason: string): ExactPreviewResult {
    return {
      exactPreviewAvailable: false,
      previewMode: "predicted",
      reason,
      changedFiles: [],
      diff: "No exact preview diff generated.",
      validationReport: "No validation output for exact preview.",
      validationResults: []
    };
  }
}
