# Phase 2 Integration Audit

## Phase 1 duplication identified

1. `MockProvider` + synthetic debate output duplicated runtime capabilities already present in `openclaude` CLI execution.
2. Phase 1 debate execution did not use real tool calls for file edits/commands.
3. Validation and repair were simulated rather than routed through real runtime tool execution.

## Replacements made in Phase 2

- Debate turns now invoke the real `openclaude` runtime via CLI (`npx @gitlawb/openclaude`) using `--print --output-format stream-json`.
- Implementer and verifier turns run with edit-capable permission modes so runtime tools can modify files and run commands.
- Post-execution diff is sourced from `git diff` in the selected project.
- Repair loop is triggered on validation failure heuristics and re-runs validation after repair.

## Custom code that remains and why

- `DebateManager` orchestration remains custom: it coordinates role sequencing and repair policy specific to Inno Code UX.
- Electron IPC bridge remains custom: required to connect desktop UI to local runtime process.
- Stream event normalization remains custom: openclaude stream-json payloads are surfaced to UI logs.
