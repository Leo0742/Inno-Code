# Inno Code

Inno Code is a desktop coding assistant (Electron + React) that runs multi-agent debate/planning through `@gitlawb/openclaude`, then gates repository mutation behind explicit user approval.

## Current status (Alpha hardening)

### What works now
- Engine-owned orchestration path for debate planning and apply/validation.
- Desktop app with staged flow: **plan → pending review → apply/discard → validation**.
- **Live runtime event streaming** from Electron main to renderer for planning/apply progress.
- Persisted settings (rounds, repair attempts, validation commands, approval requirement, role model map).
- Editable role-to-model mappings for architect, critic, implementer, judge, verifier.
- Local command-based validation execution with real command exit codes.
- Verifier model used as a **post-validation summarizer** (not as command executor).

### Pre-apply preview truthfulness
- Pre-apply preview is explicitly labeled as **predicted** model output.
- Predicted changed files + implementation checklist are shown as planning artifacts.
- Actual source of truth remains post-apply `git diff` and command validation results.

### What is still incomplete
- Cancel-in-flight execution is not implemented yet.
- Partial/hunk apply is not implemented (full apply/discard only).
- Runtime semantics depend on openclaude stream format quality.

## Architecture split
- `packages/engine`: single source of truth for debate orchestration, apply policy, validation loop, runtime event normalization.
- `apps/desktop/electron`: IPC bridge, **runtime event forwarding**, settings persistence, project picker, app lifecycle, pending session state.
- `apps/desktop/src`: renderer UX for planning/review/apply flow and live logs.

## Setup
```bash
npm install
```

> Provider credentials are managed by openclaude runtime configuration (not stored by Inno Code).

## Development
```bash
npm run dev
```
This runs:
- Vite renderer dev server
- Electron main process
- Engine TypeScript watch build

## Quality checks
```bash
npm test
npm run typecheck
npm run build
```

## Packaging
```bash
npm run -w @inno/desktop package:mac
npm run -w @inno/desktop package:win
```

## App workflow
1. Open a project folder (git repo).
2. Configure settings (including role-model mapping + validation commands).
3. Run planning debate and watch live events.
4. Review final plan + predicted pre-apply artifacts.
5. Explicitly **Apply Approved Plan** or **Discard Pending Plan**.
6. Review verifier summary + validation report + applied repository diff.
