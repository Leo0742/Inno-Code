import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { DebateManager, OpenClaudeCliRuntime } from "@inno/engine";
import { createPendingPlanStore, defaultSettings, mergeSettings } from "./state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runtime = new OpenClaudeCliRuntime();
const manager = new DebateManager(runtime);
let pendingPlans;

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

app.whenReady().then(async () => {
  pendingPlans = createPendingPlanStore({ filePath: getPendingPlansPath() });
  await pendingPlans.restore();

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

  ipcMain.handle("debate:plan", async (event, payload) => {
    const streamId = payload.streamId || `plan-${Date.now()}`;
    const settings = await loadSettings();
    const { onLog } = createLiveCollector(event, streamId);
    const plan = await manager.runPlanning({
      task: payload.task,
      projectPath: payload.projectPath,
      config: settings,
      onLog
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
      createdAt: new Date().toISOString()
    });
    return { ...plan, streamId, sessionId, status: "pending_review" };
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
    const result = await manager.applyApprovedPlan({
      task: session.task,
      projectPath: session.projectPath,
      config: session.settings,
      finalPlan: session.finalPlan,
      approved: Boolean(payload.approved),
      onLog
    });

    if (result.applied || payload.approved === false) {
      await pendingPlans.delete(payload.sessionId);
    }

    return { ...result, streamId, status: result.applied ? "applied" : "blocked" };
  });

  ipcMain.handle("debate:discard", async (_evt, payload) => {
    await pendingPlans.delete(payload.sessionId);
    return { ok: true };
  });

  createWindow();
});
