# Inno Code

Desktop-first multi-agent coding debate app (macOS + Windows) integrated with the real `openclaude` runtime.

## What Phase 2 adds

- Real runtime-backed debate turns using `@gitlawb/openclaude` CLI.
- Real file edits and command execution through openclaude tool paths.
- Real validation + repair loop.
- Real repository diff output in review panel.

## Project structure

- `packages/engine`: debate orchestration policy around runtime turns
- `apps/desktop`: Electron + React desktop app and runtime IPC bridge
- `docs/`: plan + architecture + phase 2 audit

## Development

```bash
npm install
npm run dev
```

## Test and build

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

## Real integrated flow (local)

1. Launch app.
2. Click **Open Project Folder** and choose a git repo.
3. Enter task and run debate.
4. Review verdict, validation logs, and generated diff.

> Requires provider credentials configured for openclaude-compatible runtime usage.
