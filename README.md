# Inno Code

Inno Code is a desktop coding assistant (Electron + React) that runs multi-agent debate/planning through `@gitlawb/openclaude`, then gates repository mutation behind explicit user approval.

## Current status (Alpha hardening)

### What works now
- Engine-owned orchestration path for debate planning and apply/validation.
- Desktop app with staged flow: **plan → pending review → apply/discard → validation**, including persisted pending review sessions across restart.
- **Pending Sessions UI** to browse all saved sessions, load one into review, and delete stale sessions.
- **Cancel-in-flight** support for planning and apply/validation runs with explicit cancelled status/logging.
- **Live runtime event streaming** from Electron main to renderer for planning/apply progress, isolated by active `streamId`.
- Persisted settings (rounds, repair attempts, validation commands, approval requirement, provider profiles, role model selections).
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
  - uses disposable **worktree sandbox** when repo is clean,
  - uses disposable **copy sandbox** when repo is dirty (no stash/reset/commit in real repo),
  - captures exact changed files + exact diff + optional validation output,
  - never mutates the real repository during preview generation,
  - is cleaned up when discarded/applied.
- If exact preview is unavailable (non-git/runtime failure), UI and logs clearly label fallback to predicted mode.
- Predicted preview is still structured as:
  - implementation checklist,
  - predicted changed files,
  - predicted patch text.
- Apply modes now include:
  - legacy full apply (runtime directly in repo),
  - apply all files from exact preview artifact,
  - apply selected files from exact preview artifact,
  - apply selected hunks from exact preview artifact.
- Selective apply is patch-based from the exact preview diff artifact (not model-predicted text).
- Unsupported selective patch cases (for example rename/copy or binary patch cases) are explicitly blocked and explained.
- Applied git diff can be reviewed by changed file as post-apply source of truth.

### Runtime/provider settings clarity
- In-app settings now manage provider profiles, provider type, endpoint/base URL, and role-to-provider/model mapping.
- API credentials are handled in Electron main process via encrypted local file storage (`credentials.key.json` + `credentials.secrets.json` in app userData).
- Runtime calls now inject provider credentials/endpoints into openclaude invocation env for OpenAI-compatible providers.
- Anthropic-compatible profiles are stored and visible but currently marked unsupported for runtime wiring in this phase.
- Added runtime diagnostics in settings:
  - openclaude CLI availability/version probe,
  - provider profile status (enabled, credential presence),
  - provider validation categories (missing credential / unsupported wiring),
  - startup issue recovery notes and last runtime failure summary.

### Reliability hardening in this phase
- Pending session restore now sanitizes malformed persisted entries instead of reviving partial/broken sessions.
- Exact preview lifecycle is hardened for repeated regeneration and cancellation:
  - old preview artifacts are cleaned first,
  - cancelled preview generation explicitly degrades the session back to predicted mode with a reason.
- Apply/discard cleanup paths now use safe, repeatable exact-preview sandbox cleanup.
- Selective apply now returns explicit blocked reasons when exact artifacts are missing or stale.
- Startup now records recoverable issues (restore/cleanup/CLI checks) in diagnostics instead of silently swallowing them.
- Startup detects openclaude CLI availability and surfaces first-run/runtime dependency guidance.

## Intentionally deferred in this phase
- Line-level editing/apply inside review.
- Exact pre-apply patch generation parity with post-apply output.
- IDE-grade diff/editor UX.
- Full installer/first-run wizard experience.
- Broad enterprise/perf/security platform work.

## Architecture split
- `packages/engine`: single source of truth for debate orchestration, apply policy, validation loop, runtime event normalization.
- `apps/desktop/electron`: IPC bridge, runtime process cancellation, runtime event forwarding, settings persistence, project picker, app lifecycle, pending session state.
- `apps/desktop/src`: renderer UX for planning/review/apply flow, pending session chooser, and live logs.

## Setup
```bash
npm install
```

> Provider credentials are configured in-app and encrypted at rest in local app storage.
> Runtime execution is still delegated to openclaude CLI.

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
2. Configure provider profiles + credentials + role-to-provider/model mapping and validation commands.
3. Run planning debate and watch live events.
4. Use **Pending Sessions** to choose the exact session to review/apply.
5. Review final plan + pre-apply predicted artifacts.
6. Explicitly **Apply Approved Plan**, **Discard Pending Plan**, or cancel active run.
7. Inspect validation output + file-by-file applied git diff.
