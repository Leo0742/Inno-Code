# Provider Management (Phase 3)

## What is stored
- `settings.json` stores provider profile metadata and role model selections.
- Credentials are separated from settings and stored in encrypted local files under Electron `userData`:
  - `credentials.key.json`
  - `credentials.secrets.json`

## Security boundary
- Renderer never reads raw credentials.
- Credential CRUD happens via Electron main IPC handlers.
- Current implementation uses encrypted local file storage fallback (`aes-256-gcm`) rather than OS keychain.

## Supported provider wiring
- Fully wired: `openai_compatible`, `custom_openai`.
- Partially wired/intentional fallback: `anthropic_compatible` (saved in settings, blocked for runtime with explicit diagnostic).
- `local_runtime` does not require credential injection.

## Migration behavior
- Legacy settings that only have `roleModelMap` are migrated automatically.
- A default provider profile (`default-openai`) is created when none exists.
- `roleModelSelections` is backfilled from legacy `roleModelMap`.
