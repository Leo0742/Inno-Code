import test from "node:test";
import assert from "node:assert/strict";
import {
  createPendingPlanStore,
  isRuntimeEventForActiveStream,
  mergeSettings
} from "./state.js";

function createMemoryFs() {
  const files = new Map();
  return {
    async mkdir() {},
    async writeFile(filePath, content) {
      files.set(filePath, content);
    },
    async readFile(filePath) {
      if (!files.has(filePath)) throw new Error("ENOENT");
      return files.get(filePath);
    },
    files
  };
}

test("mergeSettings keeps default roleModelMap entries while applying overrides", () => {
  const merged = mergeSettings({
    rounds: 5,
    roleModelMap: {
      architect: "gpt-5"
    }
  });

  assert.equal(merged.rounds, 5);
  assert.equal(merged.roleModelMap.architect, "gpt-5");
  assert.equal(merged.roleModelMap.verifier, "gpt-4.1-mini");
});

test("stream event filtering only accepts active stream events", () => {
  assert.equal(isRuntimeEventForActiveStream("plan-1", "plan-1"), true);
  assert.equal(isRuntimeEventForActiveStream("plan-1", "plan-2"), false);
  assert.equal(isRuntimeEventForActiveStream("", "plan-1"), false);
});

test("pending plan store supports set/get/delete lifecycle", async () => {
  const memoryFs = createMemoryFs();
  const store = createPendingPlanStore({ filePath: "/tmp/pending.json", fsModule: memoryFs });

  await store.set("s1", { task: "t" });
  assert.equal(store.size(), 1);
  assert.deepEqual(store.get("s1"), { task: "t" });

  await store.delete("s1");
  assert.equal(store.size(), 0);
  assert.equal(store.get("s1"), undefined);
});

test("pending plan store persists and restores pending review sessions", async () => {
  const memoryFs = createMemoryFs();
  const filePath = "/tmp/pending.json";
  const firstStore = createPendingPlanStore({ filePath, fsModule: memoryFs });

  await firstStore.set("session-1", {
    task: "implement feature",
    projectPath: "/repo",
    finalPlan: "1. Do thing",
    settings: { rounds: 3 },
    proposedDiff: "diff --git",
    predictedChangedFiles: ["src/a.ts"],
    implementationChecklist: ["write tests"]
  });

  const restoredStore = createPendingPlanStore({ filePath, fsModule: memoryFs });
  const restoredSessions = await restoredStore.restore();

  assert.equal(restoredSessions.length, 1);
  assert.equal(restoredSessions[0].sessionId, "session-1");
  assert.equal(restoredSessions[0].finalPlan, "1. Do thing");
  assert.deepEqual(restoredSessions[0].predictedChangedFiles, ["src/a.ts"]);
  assert.deepEqual(restoredStore.get("session-1")?.implementationChecklist, ["write tests"]);
});
