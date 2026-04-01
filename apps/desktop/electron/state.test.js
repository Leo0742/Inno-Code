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
  assert.equal(Array.isArray(merged.providerProfiles), true);
  assert.equal(merged.roleModelSelections.architect.profileId, "default-openai");
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

test("pending plan store can reconcile stale exact preview metadata", async () => {
  const memoryFs = createMemoryFs();
  const store = createPendingPlanStore({ filePath: "/tmp/pending.json", fsModule: memoryFs });
  await store.set("session-1", {
    task: "t",
    exactPreview: { exactPreviewAvailable: true, sandboxPath: "/tmp/missing", changedFiles: ["a"], diff: "x", validationReport: "y" }
  });

  await store.reconcileExactPreviews(async (session) => ({
    ...session,
    exactPreview: {
      exactPreviewAvailable: false,
      previewMode: "predicted",
      reason: "missing",
      changedFiles: [],
      diff: "No exact preview diff generated.",
      validationReport: "No validation output for exact preview."
    }
  }));

  assert.equal(store.get("session-1")?.exactPreview?.exactPreviewAvailable, false);
});

test("pending plan store drops malformed persisted entries during restore", async () => {
  const memoryFs = createMemoryFs();
  const filePath = "/tmp/pending.json";
  memoryFs.files.set(
    filePath,
    JSON.stringify([
      { sessionId: "ok", task: "t", projectPath: "/repo", finalPlan: "p", settings: { rounds: 2 }, proposedDiff: "x" },
      { sessionId: "bad-1", task: "t" },
      { nope: true }
    ])
  );
  const store = createPendingPlanStore({ filePath, fsModule: memoryFs });

  const restored = await store.restore();
  assert.equal(restored.length, 1);
  assert.equal(restored[0].sessionId, "ok");
  assert.equal(store.size(), 1);
});


test("mergeSettings migrates legacy roleModelMap to roleModelSelections", () => {
  const migrated = mergeSettings({
    roleModelMap: {
      architect: "legacy-arch",
      verifier: "legacy-verifier"
    }
  });

  assert.equal(migrated.roleModelSelections.architect.model, "legacy-arch");
  assert.equal(migrated.roleModelSelections.verifier.model, "legacy-verifier");
  assert.equal(migrated.providerProfiles[0].id, "default-openai");
});
