import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("innoCode", {
  version: "0.3.0",
  pickProject: () => ipcRenderer.invoke("project:pick"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  runPlan: (payload) => ipcRenderer.invoke("debate:plan", payload),
  applyPlan: (payload) => ipcRenderer.invoke("debate:apply", payload),
  discardPlan: (payload) => ipcRenderer.invoke("debate:discard", payload)
});
