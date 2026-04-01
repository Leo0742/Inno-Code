# Inno Code Architecture (Phase 2)

## Runtime reuse strategy

Inno Code now routes debate execution through the **real openclaude runtime path** by invoking `@gitlawb/openclaude` CLI in print streaming mode from the desktop backend.

Reused runtime capabilities through openclaude execution:
- file reads/writes via tool-enabled agent turns
- command execution
- approval/permission mode controls
- streaming event output
- MCP/tool support already available in openclaude runtime

## Engine/UI split

- `apps/desktop/electron/main.js`: IPC + runtime bridge.
- `apps/desktop/src/*`: desktop UI (project picker, task composer, debate/review/logs).
- `packages/engine`: debate orchestration policy (`DebateManager`) around runtime turns.

## Debate flow

1. Architect/Critic/Implementer run proposal, critique, revision rounds using openclaude CLI turns.
2. Judge synthesizes a final solution.
3. Verifier runs real validation command workflow through runtime.
4. On validation failure, implementer repair turn executes and validation is repeated.
5. UI shows logs + resulting `git diff` from actual workspace edits.

## Security and controls

- Permission mode is explicit per phase (`default` vs `acceptEdits`).
- No destructive actions are hidden; stream output is surfaced in logs.
- Credentials are delegated to openclaude provider/settings mechanism.
