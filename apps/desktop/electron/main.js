import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { DebateManager, OpenClaudeCliRuntime, isAbortError } from "@inno/engine";
import { createCredentialStore } from "./credentialStore.js";
import { createPendingPlanStore, defaultSettings, mergeSettings } from "./state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runtime = new OpenClaudeCliRuntime();
const manager = new DebateManager(runtime);
const execFileAsync = promisify(execFile);
let pendingPlans;
let credentialStore;
const activeRuns = new Map();
let lastRuntimeFailure = null;
let startupIssues = [];

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getPendingPlansPath() {
  return path.join(app.getPath("userData"), "pending-plans.json");
}

function buildRuntimeRoleConfiguration(settings) {
  const roleModelMap = {};
  const roleProviderMap = {};
  const unsupportedRoles = [];
  const missingCredentialRoles = [];

  for (const [role, selection] of Object.entries(settings.roleModelSelections || {})) {
    const profile = settings.providerProfiles.find((item) => item.id === selection.profileId && item.enabled);
    roleModelMap[role] = selection.model;

    if (!profile) {
      unsupportedRoles.push(`${role}: selected profile is missing or disabled`);
      continue;
    }
    if (profile.providerType === "anthropic_compatible") {
      unsupportedRoles.push(`${role}: anthropic-compatible wiring is not available in this phase`);
      continue;
    }
    if (profile.providerType === "local_runtime") {
      roleProviderMap[role] = { envOverrides: {} };
      continue;
    }

    const envOverrides = {};
    if (profile.endpoint) envOverrides.OPENAI_BASE_URL = profile.endpoint;
    if (profile.organization) envOverrides.OPENAI_ORG_ID = profile.organization;
    if (profile.project) envOverrides.OPENAI_PROJECT_ID = profile.project;
    for (const [headerKey, headerValue] of Object.entries(profile.extraHeaders || {})) {
      if (!headerKey || typeof headerValue !== "string") continue;
      envOverrides[`OPENCLAUDE_HEADER_${headerKey.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`] = headerValue;
    }
    roleProviderMap[role] = { envOverrides };
  }

  return { roleModelMap, roleProviderMap, unsupportedRoles, missingCredentialRoles };
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf8");
    return mergeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings;
  }
}

async function saveSettings(nextSettings) {
  await fs.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  const merged = mergeSettings(nextSettings);
  await fs.writeFile(getSettingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

async function resolveRuntimeConfig(settings) {
  const { roleModelMap, roleProviderMap, unsupportedRoles } = buildRuntimeRoleConfiguration(settings);
  const credentialsMissing = [];

  for (const [role, selection] of Object.entries(settings.roleModelSelections || {})) {
    const profile = settings.providerProfiles.find((item) => item.id === selection.profileId && item.enabled);
    if (!profile || profile.providerType === "local_runtime" || profile.providerType === "anthropic_compatible") continue;
    const secret = await credentialStore.getSecret(profile.credentialRef);
    if (!secret) {
      credentialsMissing.push(`${role}: missing credential for ${profile.displayName}`);
      continue;
    }
    roleProviderMap[role] = {
      envOverrides: {
        ...(roleProviderMap[role]?.envOverrides || {}),
        OPENAI_API_KEY: secret
      }
    };
  }

  return {
    ...settings,
    roleModelMap,
    roleProviderMap,
    providerValidation: {
      credentialsMissing,
      unsupportedRoles
    }
  };
}

function createLiveCollector(event, streamId) {
  const onLog = (runtimeEvent) => {
    event.sender.send("runtime:event", {
      streamId,
      ts: Date.now(),
      event: runtimeEvent
    });
  };
  return { onLog };
}

function registerActiveRun(streamId, kind) {
  if (activeRuns.has(streamId)) {
    throw new Error(`Stream id collision for ${streamId}. Retry operation.`);
  }
  const abortController = new AbortController();
  activeRuns.set(streamId, { kind, abortController, createdAt: Date.now() });
  return abortController;
}

function clearActiveRun(streamId) {
  activeRuns.delete(streamId);
}

function captureRuntimeFailure(kind, error) {
  lastRuntimeFailure = {
    at: new Date().toISOString(),
    kind,
    message: String(error)
  };
}

async function safeCleanupExactPreview(projectPath, sandboxPath) {
  if (!projectPath || !sandboxPath) return;
  try {
    await manager.cleanupExactPreview(projectPath, sandboxPath);
  } catch (error) {
    captureRuntimeFailure("cleanup_failure", error);
  }
}

function blockedApplyResult(streamId, applyMode, reason, blockedReasons = []) {
  return {
    streamId,
    validationReport: reason,
    validationResults: [],
    diff: "No diff generated.",
    changedFiles: [],
    applyMode,
    messages: [],
    applied: false,
    blockedReasons,
    status: "blocked"
  };
}

async function getRuntimeDiagnostics() {
  let openClaudeCliAvailable = false;
  let version = "";
  try {
    const { stdout } = await execFileAsync("npx", ["-y", "@gitlawb/openclaude", "--version"], {
      maxBuffer: 5 * 1024 * 1024
    });
    openClaudeCliAvailable = true;
    version = stdout.trim();
  } catch (error) {
    openClaudeCliAvailable = false;
    version = `Unavailable: ${String(error)}`;
  }

  const settings = await loadSettings();
  const providerStatuses = [];
  for (const profile of settings.providerProfiles) {
    providerStatuses.push({
      profileId: profile.id,
      displayName: profile.displayName,
      providerType: profile.providerType,
      enabled: profile.enabled,
      hasCredential: await credentialStore.hasSecret(profile.credentialRef)
    });
  }

  const runtimeMapped = await resolveRuntimeConfig(settings);

  return {
    openClaudeCliAvailable,
    openClaudeVersion: version,
    providerConfigurationOwner: "inno_code_with_openclaude_runtime",
    providerStorage: credentialStore.storageKind,
    activeProviderProfiles: settings.providerProfiles.filter((profile) => profile.enabled).map((profile) => profile.displayName),
    providerStatuses,
    providerValidation: runtimeMapped.providerValidation,
    startupIssues,
    guidance: [
      "Provider profiles and credentials are configured in Inno Code settings.",
      "Credentials are stored in Electron main process encrypted local storage.",
      "OpenAI-compatible providers are fully wired through runtime env injection.",
      "Anthropic-compatible profiles are saved but currently surfaced as unsupported runtime wiring.",
      "If runtime calls fail, verify openclaude CLI setup in your shell."
    ],
    lastRuntimeFailure
  };
}

app.whenReady().then(async () => {
  credentialStore = createCredentialStore({ dataPath: app.getPath("userData") });
  pendingPlans = createPendingPlanStore({ filePath: getPendingPlansPath() });
  try {
    await pendingPlans.restore();
  } catch (error) {
    startupIssues.push(`Pending review restore failed: ${String(error)}`);
  }
  try {
    const removed = await manager.cleanupStalePreviewSandboxes();
    if (removed > 0) startupIssues.push(`Removed ${removed} stale exact preview sandbox(es) during startup.`);
  } catch (error) {
    startupIssues.push(`Stale sandbox cleanup failed: ${String(error)}`);
  }
  await pendingPlans.reconcileExactPreviews(async (session) => {
    if (!session?.exactPreview?.sandboxPath) return session;
    try {
      await fs.access(session.exactPreview.sandboxPath);
      return session;
    } catch {
      return {
        ...session,
        exactPreview: {
          exactPreviewAvailable: false,
          previewMode: "predicted",
          reason: "Exact preview sandbox is no longer available. Regenerate preview to continue.",
          changedFiles: [],
          diff: "No exact preview diff generated.",
          validationReport: "No validation output for exact preview."
        }
      };
    }
  });
  const runtimeDiagnostics = await getRuntimeDiagnostics();
  if (!runtimeDiagnostics.openClaudeCliAvailable) {
    startupIssues.push("openclaude CLI check failed. Planning/apply actions will fail until runtime is available.");
  }

  ipcMain.handle("project:pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.filePaths[0] ?? "";
  });

  ipcMain.handle("settings:get", async () => loadSettings());

  ipcMain.handle("settings:save", async (_evt, nextSettings) => {
    return saveSettings(nextSettings);
  });

  ipcMain.handle("credentials:set", async (_evt, payload) => credentialStore.setSecret(payload.credentialRef, payload.secret));
  ipcMain.handle("credentials:delete", async (_evt, payload) => credentialStore.deleteSecret(payload.credentialRef));
  ipcMain.handle("credentials:status", async (_evt, payload) => ({ hasCredential: await credentialStore.hasSecret(payload.credentialRef) }));

  ipcMain.handle("provider:test", async (_evt, payload) => {
    const settings = mergeSettings(payload.settings);
    const runtimeSettings = await resolveRuntimeConfig(settings);
    const role = payload.role || "architect";
    if (runtimeSettings.providerValidation.unsupportedRoles.find((entry) => entry.startsWith(`${role}:`))) {
      return { ok: false, category: "unsupported_provider", message: "Selected provider type is not wired for runtime yet." };
    }
    if (runtimeSettings.providerValidation.credentialsMissing.find((entry) => entry.startsWith(`${role}:`))) {
      return { ok: false, category: "missing_credential", message: "No credential saved for selected provider profile." };
    }
    return { ok: true, category: "ok", message: "Provider role wiring looks valid for runtime invocation." };
  });

  ipcMain.handle("pending:get", async () => {
    return pendingPlans.list();
  });
  ipcMain.handle("runtime:diagnostics", async () => getRuntimeDiagnostics());

  ipcMain.handle("debate:plan", async (event, payload) => {
    const streamId = payload.streamId || `plan-${Date.now()}`;
    const settings = await resolveRuntimeConfig(await loadSettings());
    if (settings.providerValidation.credentialsMissing.length || settings.providerValidation.unsupportedRoles.length) {
      return {
        streamId,
        status: "blocked",
        messages: [],
        finalPlan: "",
        proposedDiff: "No proposed diff generated.",
        predictedChangedFiles: [],
        implementationChecklist: [],
        blockedReasons: [...settings.providerValidation.credentialsMissing, ...settings.providerValidation.unsupportedRoles]
      };
    }
    const { onLog } = createLiveCollector(event, streamId);
    const abortController = registerActiveRun(streamId, "plan");

    try {
      const plan = await manager.runPlanning({
        task: payload.task,
        projectPath: payload.projectPath,
        config: settings,
        onLog,
        signal: abortController.signal
      });
      const sessionId = `${Date.now()}`;
      await pendingPlans.set(sessionId, {
        task: payload.task,
        projectPath: payload.projectPath,
        finalPlan: plan.finalPlan,
        settings,
        proposedDiff: plan.proposedDiff,
        predictedChangedFiles: plan.predictedChangedFiles,
        implementationChecklist: plan.implementationChecklist,
        exactPreview: null,
        createdAt: new Date().toISOString()
      });
      return { ...plan, streamId, sessionId, status: "pending_review" };
    } catch (error) {
      if (isAbortError(error)) {
        event.sender.send("runtime:event", {
          streamId,
          ts: Date.now(),
          event: { type: "phase_event", phase: "revision", message: "Run cancelled by user.", raw: "cancelled" }
        });
        throw new Error("Run cancelled");
      }
      captureRuntimeFailure("planning_failure", error);
      throw error;
    } finally {
      clearActiveRun(streamId);
    }
  });

  ipcMain.handle("debate:apply", async (event, payload) => {
    const streamId = payload.streamId || `apply-${Date.now()}`;
    const session = pendingPlans.get(payload.sessionId);
    if (!session) {
      return {
        streamId,
        validationReport: "Missing pending session.",
        validationResults: [],
        diff: "No diff generated.",
        messages: [],
        applied: false,
        blockedReasons: ["Session is missing, stale, discarded, or already applied."],
        status: "error"
      };
    }
    if (payload.applyMode !== "runtime_full" && !session.exactPreview?.exactPreviewAvailable) {
      return blockedApplyResult(
        streamId,
        payload.applyMode,
        "Selective apply is blocked because exact sandbox preview is unavailable.",
        ["Generate an exact preview first, then retry selective apply."]
      );
    }

    const { onLog } = createLiveCollector(event, streamId);
    const abortController = registerActiveRun(streamId, "apply");

    try {
      let result;
      if (payload.applyMode === "exact_selected_files" || payload.applyMode === "exact_selected_hunks" || payload.applyMode === "exact_all") {
        const exactPreview = session.exactPreview;
        if (!exactPreview?.exactPreviewAvailable || !exactPreview.sandboxPath) {
          return blockedApplyResult(
            streamId,
            payload.applyMode,
            "Selective apply is blocked because exact sandbox preview is unavailable.",
            ["Regenerate exact preview because preview artifacts are stale or missing."]
          );
        }
        result = await manager.applyFromExactPreviewArtifact({
          projectPath: session.projectPath,
          sandboxPath: exactPreview.sandboxPath,
          applyMode: payload.applyMode,
          selectedFiles: payload.selectedFiles,
          selectedHunks: payload.selectedHunks,
          config: session.settings,
          onLog,
          signal: abortController.signal
        });
      } else {
        result = await manager.applyApprovedPlan({
          task: session.task,
          projectPath: session.projectPath,
          config: session.settings,
          finalPlan: session.finalPlan,
          approved: Boolean(payload.approved),
          onLog,
          signal: abortController.signal
        });
      }

      if (result.applied || payload.approved === false) {
        if (session.exactPreview?.sandboxPath) {
          await safeCleanupExactPreview(session.projectPath, session.exactPreview.sandboxPath);
        }
        await pendingPlans.delete(payload.sessionId);
      }

      return { ...result, streamId, status: result.applied ? "applied" : "blocked" };
    } catch (error) {
      if (isAbortError(error)) {
        event.sender.send("runtime:event", {
          streamId,
          ts: Date.now(),
          event: { type: "phase_event", phase: "validation", message: "Run cancelled by user.", raw: "cancelled" }
        });
        throw new Error("Run cancelled");
      }
      captureRuntimeFailure("apply_failure", error);
      throw error;
    } finally {
      clearActiveRun(streamId);
    }
  });

  ipcMain.handle("debate:cancel", async (_event, payload) => {
    const activeRun = activeRuns.get(payload.streamId);
    if (!activeRun) return { ok: false, message: "No active run found." };
    activeRun.abortController.abort();
    clearActiveRun(payload.streamId);
    return { ok: true, message: `Cancelled ${activeRun.kind} run.` };
  });

  ipcMain.handle("debate:discard", async (_evt, payload) => {
    const session = pendingPlans.get(payload.sessionId);
    if (session?.exactPreview?.sandboxPath) {
      await safeCleanupExactPreview(session.projectPath, session.exactPreview.sandboxPath);
    }
    await pendingPlans.delete(payload.sessionId);
    return { ok: true };
  });

  ipcMain.handle("debate:preview:exact", async (event, payload) => {
    const streamId = payload.streamId || `preview-${Date.now()}`;
    const session = pendingPlans.get(payload.sessionId);
    if (!session) {
      return {
        streamId,
        exactPreviewAvailable: false,
        previewMode: "predicted",
        reason: "Missing pending session.",
        changedFiles: [],
        diff: "No exact preview diff generated.",
        validationReport: "No validation output for exact preview.",
        validationResults: []
      };
    }
    if (session.exactPreview?.sandboxPath) {
      await safeCleanupExactPreview(session.projectPath, session.exactPreview.sandboxPath);
    }

    const { onLog } = createLiveCollector(event, streamId);
    const abortController = registerActiveRun(streamId, "preview");
    try {
      const preview = await manager.generateExactPreview({
        task: session.task,
        projectPath: session.projectPath,
        config: session.settings,
        finalPlan: session.finalPlan,
        onLog,
        signal: abortController.signal
      });
      await pendingPlans.set(payload.sessionId, {
        ...session,
        exactPreview: {
          exactPreviewAvailable: preview.exactPreviewAvailable,
          previewMode: preview.previewMode,
          reason: preview.reason,
          sandboxPath: preview.sandboxPath,
          sandboxKind: preview.sandboxKind,
          changedFiles: preview.changedFiles,
          diff: preview.diff,
          validationReport: preview.validationReport,
          unsupportedFiles: preview.unsupportedFiles,
          createdAt: new Date().toISOString()
        }
      });
      return { ...preview, streamId };
    } catch (error) {
      if (isAbortError(error)) {
        await pendingPlans.set(payload.sessionId, {
          ...session,
          exactPreview: {
            exactPreviewAvailable: false,
            previewMode: "predicted",
            reason: "Exact preview generation was cancelled. Existing preview artifacts were cleared for safety.",
            changedFiles: [],
            diff: "No exact preview diff generated.",
            validationReport: "No validation output for exact preview."
          }
        });
        throw new Error("Run cancelled");
      }
      captureRuntimeFailure("exact_preview_failure", error);
      throw error;
    } finally {
      clearActiveRun(streamId);
    }
  });

  createWindow();
});
