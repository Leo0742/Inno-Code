import { describe, expect, it } from "vitest";
import { DebateManager, type RuntimeClient, type RuntimeEvent } from "../src/index.js";

class FakeRuntime implements RuntimeClient {
  calls: Array<{ prompt: string; permissionMode?: string }> = [];

  async runTurn(input: { prompt: string; permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" }) {
    this.calls.push({ prompt: input.prompt, permissionMode: input.permissionMode });
    return {
      output: input.prompt.includes("Generate a proposed unified diff") ? "diff --git a/a b/a" : "ok",
      rawEvents: [],
      events: [{ type: "agent_finished", message: "done", raw: "{}" } as RuntimeEvent],
      exitCode: 0
    };
  }
}

describe("DebateManager", () => {
  it("keeps planning in plan permission mode", async () => {
    const rt = new FakeRuntime();
    const manager = new DebateManager(rt);

    const result = await manager.runPlanning({
      task: "Add feature",
      projectPath: process.cwd(),
      config: {
        rounds: 2,
        repairAttempts: 1,
        approvalRequiredForApply: true,
        validationCommands: ["echo ok"],
        roleModelMap: { architect: "a", critic: "b", implementer: "c", judge: "d", verifier: "e" }
      }
    });

    expect(result.approvalRequired).toBe(true);
    expect(result.proposedDiff).toContain("diff --git");
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
      config: {
        rounds: 1,
        repairAttempts: 0,
        approvalRequiredForApply: true,
        validationCommands: ["echo ok"],
        roleModelMap: { architect: "a", critic: "b", implementer: "c", judge: "d", verifier: "e" }
      }
    });

    expect(result.applied).toBe(false);
    expect(rt.calls.length).toBe(0);
  });
});
