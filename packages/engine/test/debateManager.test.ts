import { describe, expect, it } from "vitest";
import { DebateManager, type RuntimeClient, type RuntimeEvent } from "../src/index.js";

class FakeRuntime implements RuntimeClient {
  calls: Array<{ model: string; prompt: string; permissionMode?: string }> = [];

  async runTurn(input: { model: string; prompt: string; permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" }) {
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
  });

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
  });
});
