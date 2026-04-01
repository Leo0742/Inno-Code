# Inno Code

Inno Code is a desktop coding assistant (Electron + React) that runs multi-agent debate/planning through `@gitlawb/openclaude`, then gates repository mutation behind explicit user approval.

## Current status (Phase hardening)

### What works now
- Engine-owned orchestration path for debate planning and apply/validation.
- Desktop app with staged flow: **plan → review → apply/discard → validation**.
- Structured runtime event normalization (typed event categories).
- Persisted settings (rounds, repair attempts, validation commands, approval requirement, role model map).
- Local validation execution with real command exit codes.

### What is still incomplete
- Proposed diff is model-generated text and not yet guaranteed to be exact patch output.
- Cancel-in-flight execution is not implemented yet.
- Partial/hunk apply is not implemented (full apply/discard only).
- Runtime semantics depend on openclaude stream format quality.

## Architecture split
- `packages/engine`: single source of truth for debate orchestration, apply policy, validation loop, runtime event normalization.
- `apps/desktop/electron`: IPC bridge, settings persistence, project picker, app lifecycle, session state.
- `apps/desktop/src`: renderer UX for planning/review/apply flow.

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
2. Configure settings.
3. Run planning debate.
4. Review final plan + proposed diff.
5. Explicitly **Apply Approved Plan** or **Discard Pending Plan**.
6. Review validation report and applied repository diff.
