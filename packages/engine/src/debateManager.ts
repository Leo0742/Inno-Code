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

interface ParsedHunk {
  hunkHeader: string;
  lines: string[];
}

interface ParsedPatchFile {
  filePath: string;
  status: string;
  headerLines: string[];
  hunks: ParsedHunk[];
  fullPatch: string;
  hasBinaryPatch: boolean;
}

function parsePatchFiles(rawDiff: string): ParsedPatchFile[] {
  const lines = rawDiff.split("\n");
  const files: ParsedPatchFile[] = [];
  let current: ParsedPatchFile | null = null;
  let currentHunk: ParsedHunk | null = null;

  const flushHunk = () => {
    if (!current || !currentHunk) return;
    current.hunks.push(currentHunk);
    currentHunk = null;
  };
  const flushFile = () => {
    if (!current) return;
    flushHunk();
    files.push(current);
    current = null;
  };

  for (const line of lines) {
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch) {
      flushFile();
      current = {
        filePath: diffMatch[2],
        status: "M",
        headerLines: [line],
        hunks: [],
        fullPatch: "",
        hasBinaryPatch: false
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.status = "A";
    if (line.startsWith("deleted file mode")) current.status = "D";
    if (line.startsWith("similarity index") || line.startsWith("rename from ") || line.startsWith("rename to ")) current.status = "R";
    if (line.includes("Binary files ") || line.includes("GIT binary patch")) current.hasBinaryPatch = true;
    if (line.startsWith("@@")) {
      flushHunk();
      currentHunk = { hunkHeader: line, lines: [line] };
      continue;
    }
    if (currentHunk) {
      currentHunk.lines.push(line);
    } else {
      current.headerLines.push(line);
    }
  }
  flushFile();
  for (const file of files) {
    file.fullPatch = [...file.headerLines, ...file.hunks.flatMap((h) => h.lines)].join("\n").trim();
  }
  return files;
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
    const cleanTree = await this.isCleanWorkingTree(input.projectPath, input.signal);
    const sandboxPath = await fs.mkdtemp(path.join(os.tmpdir(), cleanTree ? "inno-preview-worktree-" : "inno-preview-copy-"));
    let sandboxKind: "worktree" | "copy" = cleanTree ? "worktree" : "copy";
    let attachedWorktree = false;
    try {
      if (cleanTree) {
        await this.runGit(input.projectPath, ["worktree", "add", "--detach", sandboxPath, "HEAD"], input.signal);
        attachedWorktree = true;
      } else {
        await fs.rm(sandboxPath, { recursive: true, force: true });
        await fs.cp(input.projectPath, sandboxPath, { recursive: true });
      }
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

      const diff = await this.collectDiff(sandboxPath, input.signal);
      const parsedFiles = parsePatchFiles(diff);
      const changedFiles = parsedFiles.map((entry) => entry.filePath);
      const unsupportedFiles = parsedFiles
        .filter((entry) => entry.status === "R" || entry.hasBinaryPatch)
        .map((entry) => ({
          filePath: entry.filePath,
          reason: entry.status === "R" ? "Rename/copy patches are not supported for selective apply." : "Binary patches are not supported."
        }));
      const validationResults = await this.runValidationCommands(sandboxPath, input.config, input.onLog, input.signal);
      const validationReport = formatValidationReport(validationResults);

      return {
        exactPreviewAvailable: true,
        previewMode: "exact",
        sandboxPath,
        sandboxKind,
        changedFiles,
        diff,
        validationReport,
        validationResults,
        unsupportedFiles
      };
    } catch (error) {
      if (attachedWorktree) {
        await this.cleanupWorktree(input.projectPath, sandboxPath);
      } else {
        await fs.rm(sandboxPath, { recursive: true, force: true });
      }
      if (isAbortError(error)) throw error;
      return this.createPredictedFallback(`Exact preview failed: ${(error as Error).message}`);
    }
  }

  async cleanupExactPreview(projectPath: string, sandboxPath: string): Promise<void> {
    await this.cleanupSandbox(projectPath, sandboxPath);
  }

  async applyFromExactPreviewArtifact(input: {
    projectPath: string;
    sandboxPath: string;
    applyMode: "exact_all" | "exact_selected_files" | "exact_selected_hunks";
    selectedFiles?: string[];
    selectedHunks?: Array<{ filePath: string; hunkIndex: number }>;
    config: DebateConfig;
    onLog?: (event: RuntimeEvent) => void;
    signal?: AbortSignal;
  }): Promise<ApplyRunResult> {
    throwIfAborted(input.signal);
    const diff = await this.collectDiff(input.sandboxPath, input.signal);
    const patchFiles = parsePatchFiles(diff);
    const fileSet = new Set(patchFiles.map((entry) => entry.filePath));
    const blockedReasons: string[] = [];

    const unsupported = patchFiles.filter((entry) => entry.status === "R" || entry.hasBinaryPatch);
    if (unsupported.length && input.applyMode !== "exact_all") {
      blockedReasons.push(
        ...unsupported.map((entry) =>
          `${entry.filePath}: ${entry.status === "R" ? "rename/copy patch unsupported for selective apply" : "binary patch unsupported"}`
        )
      );
    }

    if (blockedReasons.length) {
      return {
        messages: [],
        validationReport: "Apply blocked due to unsupported selective patch cases.",
        validationResults: [],
        diff: "No diff generated.",
        applied: false,
        applyMode: input.applyMode,
        changedFiles: [],
        blockedReasons
      };
    }
    let selectedFiles: string[] = [];
    if (input.applyMode === "exact_all") {
      selectedFiles = patchFiles.map((entry) => entry.filePath);
      await this.applyPatchText(input.projectPath, patchFiles.map((entry) => entry.fullPatch).join("\n"), input.signal);
    } else if (input.applyMode === "exact_selected_files") {
      selectedFiles = (input.selectedFiles || []).filter((file) => fileSet.has(file));
      if (!selectedFiles.length) {
        return {
          messages: [],
          validationReport: "Apply blocked: no selectable files were chosen.",
          validationResults: [],
          diff: "No diff generated.",
          applied: false,
          applyMode: input.applyMode,
          changedFiles: [],
          blockedReasons: ["No files selected."]
        };
      }
      const filePatches = patchFiles.filter((entry) => selectedFiles.includes(entry.filePath)).map((entry) => entry.fullPatch).join("\n");
      await this.applyPatchText(input.projectPath, filePatches, input.signal);
    } else {
      const selectedHunks = input.selectedHunks || [];
      if (!selectedHunks.length) {
        return {
          messages: [],
          validationReport: "Apply blocked: no hunks were selected.",
          validationResults: [],
          diff: "No diff generated.",
          applied: false,
          applyMode: input.applyMode,
          changedFiles: [],
          blockedReasons: ["No hunks selected."]
        };
      }
      const selectedByFile = new Map<string, Set<number>>();
      for (const entry of selectedHunks) {
        if (!fileSet.has(entry.filePath)) continue;
        selectedByFile.set(entry.filePath, selectedByFile.get(entry.filePath) || new Set<number>());
        selectedByFile.get(entry.filePath)!.add(entry.hunkIndex);
      }
      const patchText = patchFiles
        .map((file) => {
          const indexes = selectedByFile.get(file.filePath);
          if (!indexes?.size) return "";
          const hunks = file.hunks.filter((_h, idx) => indexes.has(idx)).flatMap((h) => h.lines);
          if (!hunks.length) return "";
          selectedFiles.push(file.filePath);
          return [...file.headerLines, ...hunks].join("\n");
        })
        .filter(Boolean)
        .join("\n");
      if (!patchText.trim()) {
        return {
          messages: [],
          validationReport: "Apply blocked: selected hunks could not be resolved.",
          validationResults: [],
          diff: "No diff generated.",
          applied: false,
          applyMode: input.applyMode,
          changedFiles: [],
          blockedReasons: ["Selected hunk references were invalid."]
        };
      }
      await this.applyPatchText(input.projectPath, patchText, input.signal);
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
      applyMode: input.applyMode,
      changedFiles: Array.from(new Set(selectedFiles))
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

  private async cleanupSandbox(projectPath: string, sandboxPath: string): Promise<void> {
    await this.cleanupWorktree(projectPath, sandboxPath);
    await fs.rm(sandboxPath, { recursive: true, force: true });
  }

  async cleanupStalePreviewSandboxes(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const tempDir = os.tmpdir();
    const entries = await fs.readdir(tempDir, { withFileTypes: true });
    const now = Date.now();
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith("inno-preview-worktree-") && !entry.name.startsWith("inno-preview-copy-")) continue;
      const target = path.join(tempDir, entry.name);
      try {
        const stat = await fs.stat(target);
        if (now - stat.mtimeMs < maxAgeMs) continue;
        await fs.rm(target, { recursive: true, force: true });
        removed += 1;
      } catch {
        // ignore cleanup race conditions
      }
    }
    return removed;
  }

  private async applyPatchText(projectPath: string, patchText: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const patchPath = path.join(os.tmpdir(), `inno-apply-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
    await fs.writeFile(patchPath, `${patchText.trim()}\n`, "utf8");
    try {
      await execFileAsync("git", ["-C", projectPath, "apply", "--3way", "--whitespace=nowarn", patchPath], {
        maxBuffer: 10 * 1024 * 1024,
        signal
      });
    } finally {
      await fs.rm(patchPath, { force: true });
    }
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
