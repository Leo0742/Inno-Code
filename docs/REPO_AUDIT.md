# External Repository Audit Notes

This project was initialized by inspecting:

1. `openclaude` (primary base): TypeScript runtime with task/session/provider modules that align with Inno Code's engine needs.
2. `claude-code` (reference only): naming and module layout ideas for runtime/bootstrap/task organization.
3. `opencode` (product inspiration): desktop UX and visible workflow presentation patterns.

Resulting decision:
- Keep Inno Code TypeScript-first and engine-first.
- Implement debate orchestration as a dedicated service layer.
- Build a desktop-first Electron app with explicit debate + review + logs surfaces.
