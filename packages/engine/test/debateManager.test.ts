import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DebateManager, type RuntimeClient, type RuntimeEvent } from "../src/index.js";

const execFileAsync = promisify(execFile);

class FakeRuntime implements RuntimeClient {
  calls: Array<{ model: string; prompt: string; permissionMode?: string }> = [];

  async runTurn(input: { projectPath: string; model: string; prompt: string; permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan"; onEvent?: (event: RuntimeEvent) => void; signal?: AbortSignal }) {
    this.calls.push({ model: input.model, prompt: input.prompt, permissionMode: input.permissionMode });
    return {
      output: input.prompt.includes("Generate a proposed unified diff")
        ? "diff --git a/a.ts b/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@"
        : "- step one\n- step two",
      rawEvents: [],
      events: [{ type: "agent_finished", message: "done", raw: "{}" } as RuntimeEvent],
      exitCode: 0
    };
  }
}

class FileWritingRuntime implements RuntimeClient {
  async runTurn(input: { projectPath: string; model: string; prompt: string; permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan"; onEvent?: (event: RuntimeEvent) => void; signal?: AbortSignal }) {
    if (input.permissionMode === "acceptEdits") {
      await fs.writeFile(path.join(input.projectPath, "a.txt"), "updated-a\n", "utf8");
      await fs.writeFile(path.join(input.projectPath, "b.txt"), "updated-b\n", "utf8");
    }
    return { output: "ok", rawEvents: [], events: [], exitCode: 0 };
  }
}

const config = {
  rounds: 2,
  repairAttempts: 1,
  approvalRequiredForApply: true,
  validationCommands: ["echo ok"],
  roleModelMap: { architect: "a", critic: "b", implementer: "c", judge: "d", verifier: "e" }
};

describe("DebateManager", () => {
  it("keeps planning in plan permission mode and returns structured pre-apply fields", async () => {
    const rt = new FakeRuntime();
    const manager = new DebateManager(rt);

    const result = await manager.runPlanning({
      task: "Add feature",
      projectPath: process.cwd(),
      config
    });

    expect(result.approvalRequired).toBe(true);
    expect(result.proposedDiff).toContain("diff --git");
    expect(result.predictedChangedFiles).toContain("a.ts");
    expect(result.implementationChecklist).toContain("- step one");
    expect(rt.calls.every((call) => call.permissionMode === "plan")).toBe(true);
  });

  it("blocks apply when approval is required but not granted", async () => {
    const rt = new FakeRuntime();
    const manager = new DebateManager(rt);

    const result = await manager.applyApprovedPlan({
      task: "Do task",
      finalPlan: "plan",
      approved: false,
      projectPath: process.cwd(),
      config
    });

    expect(result.applied).toBe(false);
    expect(result.applyMode).toBe("runtime_full");
    expect(rt.calls.length).toBe(0);
  });

  it("uses verifier model for post-validation summary", async () => {
    const rt = new FakeRuntime();
    const manager = new DebateManager(rt);

    await manager.applyApprovedPlan({
      task: "Do task",
      finalPlan: "plan",
      approved: true,
      projectPath: process.cwd(),
      config: { ...config, validationCommands: ["echo ok"], repairAttempts: 0, approvalRequiredForApply: false }
    });

    expect(rt.calls.some((call) => call.model === "e" && call.permissionMode === "plan")).toBe(true);
  }, 20000);

  it("emits phase and validation events during apply flow", async () => {
    const rt = new FakeRuntime();
    const manager = new DebateManager(rt);
    const events: RuntimeEvent[] = [];

    await manager.applyApprovedPlan({
      task: "Do task",
      finalPlan: "plan",
      approved: true,
      projectPath: process.cwd(),
      config: { ...config, validationCommands: ["echo ok"], repairAttempts: 0, approvalRequiredForApply: false },
      onLog: (event) => events.push(event)
    });

    expect(events.some((event) => event.type === "phase_event" && event.phase === "revision")).toBe(true);
    expect(events.some((event) => event.type === "command_event")).toBe(true);
    expect(events.some((event) => event.type === "validation_event")).toBe(true);
  }, 20000);

  it("generates exact preview in sandbox and cleans up", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inno-test-"));
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "a.txt"), "original-a\n", "utf8");
    await fs.writeFile(path.join(tempDir, "b.txt"), "original-b\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

    const manager = new DebateManager(new FileWritingRuntime());
    const preview = await manager.generateExactPreview({
      task: "update files",
      finalPlan: "plan",
      projectPath: tempDir,
      config: { ...config, validationCommands: ["echo ok"] }
    });
    expect(preview.exactPreviewAvailable).toBe(true);
    expect(preview.previewMode).toBe("exact");
    expect(preview.changedFiles).toEqual(["a.txt", "b.txt"]);
    expect(preview.sandboxKind).toBe("worktree");

    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: tempDir });
    expect(stdout.trim()).toBe("");
    await manager.cleanupExactPreview(tempDir, preview.sandboxPath!);
  }, 20000);

  it("generates exact preview for dirty repos using copy sandbox", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inno-test-dirty-"));
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "a.txt"), "original\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "a.txt"), "dirty\n", "utf8");

    const manager = new DebateManager(new FileWritingRuntime());
    const preview = await manager.generateExactPreview({
      task: "update files",
      finalPlan: "plan",
      projectPath: tempDir,
      config
    });
    expect(preview.exactPreviewAvailable).toBe(true);
    expect(preview.previewMode).toBe("exact");
    expect(preview.sandboxKind).toBe("copy");
    expect(await fs.readFile(path.join(tempDir, "a.txt"), "utf8")).toBe("dirty\n");
    await manager.cleanupExactPreview(tempDir, preview.sandboxPath!);
  });

  it("applies only selected files from exact preview artifact", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inno-test-apply-"));
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "a.txt"), "original-a\n", "utf8");
    await fs.writeFile(path.join(tempDir, "b.txt"), "original-b\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });

    const manager = new DebateManager(new FileWritingRuntime());
    const preview = await manager.generateExactPreview({
      task: "update files",
      finalPlan: "plan",
      projectPath: tempDir,
      config: { ...config, validationCommands: ["echo ok"] }
    });
    const applyResult = await manager.applyFromExactPreviewArtifact({
      projectPath: tempDir,
      sandboxPath: preview.sandboxPath!,
      applyMode: "exact_selected_files",
      selectedFiles: ["a.txt"],
      config: { ...config, validationCommands: ["echo ok"] }
    });

    expect(applyResult.applied).toBe(true);
    expect(applyResult.applyMode).toBe("exact_selected_files");
    expect(applyResult.changedFiles).toEqual(["a.txt"]);
    expect(await fs.readFile(path.join(tempDir, "a.txt"), "utf8")).toContain("updated-a");
    expect(await fs.readFile(path.join(tempDir, "b.txt"), "utf8")).toContain("original-b");
    await manager.cleanupExactPreview(tempDir, preview.sandboxPath!);
  }, 20000);

  it("applies selected hunks from exact preview artifact", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inno-test-hunks-"));
    await execFileAsync("git", ["init"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, "a.txt"), "line1\nline2\nline3\nline4\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: tempDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: tempDir });
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "inno-manual-sandbox-"));
    await fs.cp(tempDir, sandbox, { recursive: true });
    await fs.writeFile(path.join(sandbox, "a.txt"), "line1\none\nline3\nfour\n", "utf8");

    const manager = new DebateManager(new FakeRuntime());
    const applyResult = await manager.applyFromExactPreviewArtifact({
      projectPath: tempDir,
      sandboxPath: sandbox,
      applyMode: "exact_selected_hunks",
      selectedHunks: [{ filePath: "a.txt", hunkIndex: 0 }],
      config: { ...config, validationCommands: ["echo ok"] }
    });

    expect(applyResult.applied).toBe(true);
    expect(applyResult.changedFiles).toEqual(["a.txt"]);
  }, 20000);
});
