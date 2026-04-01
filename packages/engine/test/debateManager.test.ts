import { describe, expect, it } from "vitest";
import { DebateManager, type RuntimeClient } from "../src/index.js";

class FakeRuntime implements RuntimeClient {
  calls: string[] = [];
  async runTurn(input: { prompt: string }) {
    this.calls.push(input.prompt);
    return { output: input.prompt.includes("Validate") ? "All good" : "ok", rawEvents: [] };
  }
}

describe("DebateManager", () => {
  it("runs debate, judge and validation", async () => {
    const rt = new FakeRuntime();
    const manager = new DebateManager(rt);
    const result = await manager.run({
      task: "Add feature",
      projectPath: process.cwd(),
      config: {
        rounds: 3,
        repairAttempts: 1,
        validationCommands: ["npm test"],
        roleModelMap: {
          architect: "a",
          critic: "b",
          implementer: "c",
          judge: "d",
          verifier: "e"
        }
      }
    });

    expect(result.messages.some((m) => m.role === "judge")).toBe(true);
    expect(result.validationReport.length).toBeGreaterThan(0);
    expect(rt.calls.length).toBeGreaterThan(0);
  });
});
