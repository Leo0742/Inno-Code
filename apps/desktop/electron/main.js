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
const pendingPlans = createPendingPlanStore();

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
  const logs = [];
  const onLog = (runtimeEvent) => {
    logs.push(`[${runtimeEvent.type}] ${runtimeEvent.message}`);
    event.sender.send("runtime:event", {
      streamId,
      ts: Date.now(),
      event: runtimeEvent
    });
  };
  return { logs, onLog };
}

app.whenReady().then(() => {
  ipcMain.handle("project:pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.filePaths[0] ?? "";
  });

  ipcMain.handle("settings:get", async () => loadSettings());

  ipcMain.handle("settings:save", async (_evt, nextSettings) => {
    return saveSettings(nextSettings);
  });

  ipcMain.handle("debate:plan", async (event, payload) => {
    const streamId = `plan-${Date.now()}`;
    const settings = await loadSettings();
    const { logs, onLog } = createLiveCollector(event, streamId);
    const plan = await manager.runPlanning({
      task: payload.task,
      projectPath: payload.projectPath,
      config: settings,
      onLog
    });
    const sessionId = `${Date.now()}`;
    pendingPlans.set(sessionId, {
      task: payload.task,
      projectPath: payload.projectPath,
      finalPlan: plan.finalPlan,
      settings
    });
    return { ...plan, streamId, sessionId, logs, status: "pending_review" };
  });

  ipcMain.handle("debate:apply", async (event, payload) => {
    const streamId = `apply-${Date.now()}`;
    const session = pendingPlans.get(payload.sessionId);
    if (!session) {
      return {
        streamId,
        logs: ["No pending plan found for this session."],
        validationReport: "Missing pending session.",
        validationResults: [],
        diff: "No diff generated.",
        messages: [],
        applied: false,
        status: "error"
      };
    }

    const { logs, onLog } = createLiveCollector(event, streamId);
    const result = await manager.applyApprovedPlan({
      task: session.task,
      projectPath: session.projectPath,
      config: session.settings,
      finalPlan: session.finalPlan,
      approved: Boolean(payload.approved),
      onLog
    });

    if (result.applied || payload.approved === false) {
      pendingPlans.delete(payload.sessionId);
    }

    return { ...result, streamId, logs, status: result.applied ? "applied" : "blocked" };
  });

  ipcMain.handle("debate:discard", async (_evt, payload) => {
    pendingPlans.delete(payload.sessionId);
    return { ok: true };
  });

  createWindow();
});
