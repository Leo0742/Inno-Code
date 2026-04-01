import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { DebateManager, OpenClaudeCliRuntime, isAbortError } from "@inno/engine";
import { createPendingPlanStore, defaultSettings, mergeSettings } from "./state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runtime = new OpenClaudeCliRuntime();
const manager = new DebateManager(runtime);
const execFileAsync = promisify(execFile);
let pendingPlans;
const activeRuns = new Map();
let lastRuntimeFailure = null;

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
  const abortController = new AbortController();
  activeRuns.set(streamId, { kind, abortController, createdAt: Date.now() });
  return abortController;
}

function clearActiveRun(streamId) {
  activeRuns.delete(streamId);
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
  return {
    openClaudeCliAvailable,
    openClaudeVersion: version,
    providerConfigurationOwner: "openclaude_runtime",
    guidance: [
      "Inno Code does not manage provider API keys/accounts.",
      "Configure provider credentials and auth in openclaude runtime.",
      "If runtime calls fail, verify openclaude CLI setup in your shell."
    ],
    lastRuntimeFailure
  };
}

app.whenReady().then(async () => {
  pendingPlans = createPendingPlanStore({ filePath: getPendingPlansPath() });
  await pendingPlans.restore();
  await manager.cleanupStalePreviewSandboxes().catch(() => {});
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

  ipcMain.handle("project:pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.filePaths[0] ?? "";
  });

  ipcMain.handle("settings:get", async () => loadSettings());

  ipcMain.handle("settings:save", async (_evt, nextSettings) => {
    return saveSettings(nextSettings);
  });

  ipcMain.handle("pending:get", async () => {
    return pendingPlans.list();
  });
  ipcMain.handle("runtime:diagnostics", async () => getRuntimeDiagnostics());

  ipcMain.handle("debate:plan", async (event, payload) => {
    const streamId = payload.streamId || `plan-${Date.now()}`;
    const settings = await loadSettings();
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
      lastRuntimeFailure = { at: new Date().toISOString(), message: String(error) };
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
        status: "error"
      };
    }

    const { onLog } = createLiveCollector(event, streamId);
    const abortController = registerActiveRun(streamId, "apply");

    try {
      let result;
      if (payload.applyMode === "exact_selected_files" || payload.applyMode === "exact_selected_hunks" || payload.applyMode === "exact_all") {
        const exactPreview = session.exactPreview;
        if (!exactPreview?.exactPreviewAvailable || !exactPreview.sandboxPath) {
          return {
            streamId,
            validationReport: "Selective apply is blocked because exact sandbox preview is unavailable.",
            validationResults: [],
            diff: "No diff generated.",
            changedFiles: [],
            applyMode: payload.applyMode,
            messages: [],
            applied: false,
            status: "blocked"
          };
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
          await manager.cleanupExactPreview(session.projectPath, session.exactPreview.sandboxPath);
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
      lastRuntimeFailure = { at: new Date().toISOString(), message: String(error) };
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
      await manager.cleanupExactPreview(session.projectPath, session.exactPreview.sandboxPath);
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
      await manager.cleanupExactPreview(session.projectPath, session.exactPreview.sandboxPath);
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
        throw new Error("Run cancelled");
      }
      lastRuntimeFailure = { at: new Date().toISOString(), message: String(error) };
      throw error;
    } finally {
      clearActiveRun(streamId);
    }
  });

  createWindow();
});
