# Inno Code MVP Implementation Plan

## Repository audit summary

- **Primary runtime base (`openclaude`)**: reuse core task engine concepts, provider abstraction direction, and session/task orchestration patterns from TypeScript modules (`src/tasks`, `src/server`, `src/remote`).
- **Reference only (`claude-code`)**: use naming and organization inspiration for bootstrap/runtime/query orchestration modules; do not treat it as runtime source.
- **Product inspiration (`opencode`)**: adapt desktop-first UX and a clear engine/UI boundary, with visible agent steps and cleaner session-driven flow.

## MVP steps

1. Create monorepo structure with `packages/engine` and `apps/desktop`.
2. Implement provider abstraction with OpenAI-compatible client and secure secret indirection.
3. Implement `DebateManager` orchestration for proposal/critique/revision/judge flow.
4. Build desktop React UI views:
   - project/session sidebar
   - task composer
   - debate timeline
   - review panel
   - logs panel
   - settings panel
5. Add approval-oriented review actions (apply/discard placeholders in MVP).
6. Add tests for provider + debate manager + synthesis behavior.
7. Add build/package scripts for macOS and Windows using Electron Builder.
8. Document architecture, security notes, and local run/package commands.

## Non-goals for v1

- Cloud sync
- Team collaboration
- Plugin marketplace
- Remote execution clusters
