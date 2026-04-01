import { spawn } from "node:child_process";
import type { RuntimeClient, RuntimeEvent, RuntimeTurnResult } from "./types.js";

function classifyEvent(raw: string): RuntimeEvent {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    if (/error|exception/i.test(raw)) return { type: "error_event", message: raw, raw };
    if (/diff|patch/i.test(raw)) return { type: "diff_event", message: raw, raw };
    if (/tool/i.test(raw)) return { type: "tool_event", message: raw, raw };
    if (/command|exit code/i.test(raw)) return { type: "command_event", message: raw, raw };
    return { type: "raw", message: raw, raw };
  }

  const eventType = String(parsed?.type ?? parsed?.event ?? "").toLowerCase();
  const message = extractText(parsed) || raw;

  if (eventType.includes("start")) return { type: "agent_started", message, raw };
  if (eventType.includes("finish") || eventType.includes("complete")) return { type: "agent_finished", message, raw };
  if (eventType.includes("tool")) return { type: "tool_event", message, raw };
  if (eventType.includes("command")) return { type: "command_event", message, raw };
  if (eventType.includes("error")) return { type: "error_event", message, raw };
  if (eventType.includes("diff") || eventType.includes("patch")) return { type: "diff_event", message, raw };

  return { type: "raw", message, raw };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => extractText(v)).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  for (const key of ["text", "content", "message", "result", "output", "summary"]) {
    const t = extractText(obj[key]);
    if (t) return t;
  }
  return "";
}

export class OpenClaudeCliRuntime implements RuntimeClient {
  async runTurn(input: {
    projectPath: string;
    model: string;
    prompt: string;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
    onEvent?: (event: RuntimeEvent) => void;
  }): Promise<RuntimeTurnResult> {
    const args = [
      "-y",
      "@gitlawb/openclaude",
      "-p",
      input.prompt,
      "--print",
      "--output-format",
      "stream-json",
      "--permission-mode",
      input.permissionMode ?? "default",
      "--model",
      input.model,
      "--add-dir",
      input.projectPath
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("npx", args, { cwd: input.projectPath, env: process.env });
      let buffer = "";
      const rawEvents: string[] = [];
      const events: RuntimeEvent[] = [];
      const outputs: string[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          rawEvents.push(line);
          const event = classifyEvent(line);
          events.push(event);
          input.onEvent?.(event);
          outputs.push(event.message);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const raw = chunk.toString();
        const event = classifyEvent(raw);
        events.push(event);
        input.onEvent?.(event);
      });
      child.on("error", reject);
      child.on("close", (code: number) => {
        if (code !== 0) {
          reject(new Error(`openclaude exited with code ${code}`));
          return;
        }
        resolve({ output: outputs.join("\n").trim(), rawEvents, events, exitCode: code });
      });
    });
  }
}

export { classifyEvent };
