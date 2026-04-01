# Inno Code

Inno Code is a desktop coding assistant (Electron + React) that runs multi-agent debate/planning through `@gitlawb/openclaude`, then gates repository mutation behind explicit user approval.

## Current status (Alpha hardening)

### What works now
- Engine-owned orchestration path for debate planning and apply/validation.
- Desktop app with staged flow: **plan → pending review → apply/discard → validation**, including persisted pending review sessions across restart.
- **Pending Sessions UI** to browse all saved sessions, load one into review, and delete stale sessions.
- **Cancel-in-flight** support for planning and apply/validation runs with explicit cancelled status/logging.
- **Live runtime event streaming** from Electron main to renderer for planning/apply progress, isolated by active `streamId`.
- Persisted settings (rounds, repair attempts, validation commands, approval requirement, role model map).
- Editable role-to-model mappings for architect, critic, implementer, judge, verifier.
- Local command-based validation execution with real command exit codes.
- Verifier model used as a **post-validation summarizer** (not as command executor).

### Review and diff behavior
- Review panel now separates:
  - final plan,
  - pre-apply predicted artifacts,
  - post-apply source-of-truth outputs.
- Pre-apply preview now supports two explicit modes:
  - **Predicted preview** (model-only, pre-execution estimate)
  - **Exact sandbox preview** (real diff generated in disposable git worktree)
- Exact sandbox preview:
  - requires a clean working tree,
  - runs approved plan in disposable worktree,
  - captures exact changed files + exact diff + optional validation output,
  - never mutates the real repository during preview generation,
  - is cleaned up when discarded/applied.
- If exact preview is unavailable (dirty repo/non-git/runtime failure), UI and logs clearly label fallback to predicted mode.
- Predicted preview is still structured as:
  - implementation checklist,
  - predicted changed files,
  - predicted patch text.
- Apply modes now include:
  - legacy full apply (runtime directly in repo),
  - apply all files from exact preview artifact,
  - apply selected files from exact preview artifact.
- Selective apply is intentionally file-level only (no hunk-level apply yet).
- Applied git diff can be reviewed by changed file as post-apply source of truth.

### Runtime/provider settings clarity
- In-app settings manage planner/apply flow settings only.
- Provider selection, API keys, and account/runtime auth are explicitly documented as managed by openclaude runtime outside Inno Code.
- Added lightweight runtime diagnostics in settings:
  - openclaude CLI availability/version probe,
  - last runtime invocation failure summary,
  - troubleshooting guidance and responsibility split.

## Intentionally deferred in this phase
- Partial/hunk apply (still full apply/discard only).
- Exact pre-apply patch generation parity with post-apply output.
- Full provider/key management replacement inside Inno Code.
- IDE-grade diff/editor UX.
- Remaining production hardening (packaging polish, broader reliability/perf/security hardening).

## Architecture split
- `packages/engine`: single source of truth for debate orchestration, apply policy, validation loop, runtime event normalization.
- `apps/desktop/electron`: IPC bridge, runtime process cancellation, runtime event forwarding, settings persistence, project picker, app lifecycle, pending session state.
- `apps/desktop/src`: renderer UX for planning/review/apply flow, pending session chooser, and live logs.

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
2. Configure settings (role-model mapping + validation commands + debate/apply controls).
3. Run planning debate and watch live events.
4. Use **Pending Sessions** to choose the exact session to review/apply.
5. Review final plan + pre-apply predicted artifacts.
6. Explicitly **Apply Approved Plan**, **Discard Pending Plan**, or cancel active run.
7. Inspect validation output + file-by-file applied git diff.
