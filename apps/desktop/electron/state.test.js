import test from "node:test";
import assert from "node:assert/strict";
import { createPendingPlanStore, mergeSettings } from "./state.js";

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

test("pending plan store supports set/get/delete lifecycle", () => {
  const store = createPendingPlanStore();
  store.set("s1", { task: "t" });
  assert.equal(store.size(), 1);
  assert.deepEqual(store.get("s1"), { task: "t" });

  store.delete("s1");
  assert.equal(store.size(), 0);
  assert.equal(store.get("s1"), undefined);
});
