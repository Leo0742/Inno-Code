# Inno Code Architecture

## Responsibility boundary

### `packages/engine` (single orchestration source)
- Multi-round debate planning orchestration (`runPlanning`).
- Explicit apply orchestration (`applyApprovedPlan`).
- Validation + repair loop policy.
- Runtime stream normalization to typed events.
- Final result assembly (messages, reports, diffs).

### `apps/desktop/electron` (thin bridge)
- IPC handlers only (`project:*`, `settings:*`, `debate:*`).
- Settings persistence to local `userData/settings.json`.
- Pending review session state (session id -> approved apply context).
- Project picker + app lifecycle + window boot.

### `apps/desktop/src` (renderer UX)
- Task composer and execution state.
- Settings editor + save.
- Review/apply UI with pending/applied status.
- Logs/timeline surfaces.

## Runtime integration path

1. Renderer calls `debate:plan`.
2. Electron loads persisted settings and calls `DebateManager.runPlanning`.
3. Engine runs debate roles in **plan mode**, judge synthesis, and proposed diff generation.
4. Renderer reviews results and either applies or discards.
5. On apply, renderer calls `debate:apply` with explicit approval.
6. Engine applies through implementer turn, runs validation commands locally, then optional repair loop.

## Event flow

Openclaude stream lines are normalized in engine into:
- `agent_started`
- `agent_finished`
- `tool_event`
- `command_event`
- `validation_event`
- `diff_event`
- `error_event`
- `raw`

Electron stores log lines as `[type] message` for renderer display.

## Approval model

- Planning never requests edit permissions.
- Apply requires explicit user action from pending review session.
- If `approvalRequiredForApply` is enabled, apply is blocked without approval.
- Discard clears pending plan session without mutating repository.

## Known limitations

- Proposed diff is advisory model output before apply.
- No mid-run cancellation yet.
- No partial apply/hunk selection yet.
