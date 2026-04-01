import { describe, expect, it } from "vitest";
import { classifyEvent } from "../src/runtime.js";

describe("classifyEvent", () => {
  it("classifies structured start/finish events", () => {
    expect(classifyEvent('{"type":"turn_start","message":"start"}').type).toBe("agent_started");
    expect(classifyEvent('{"type":"turn_complete","message":"done"}').type).toBe("agent_finished");
  });

  it("classifies fallback textual events", () => {
    expect(classifyEvent("tool executed successfully").type).toBe("tool_event");
    expect(classifyEvent("exception: fail").type).toBe("error_event");
  });
});
