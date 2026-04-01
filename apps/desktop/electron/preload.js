import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("innoCode", {
  version: "0.3.0",
  pickProject: () => ipcRenderer.invoke("project:pick"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  getPendingPlans: () => ipcRenderer.invoke("pending:get"),
  getRuntimeDiagnostics: () => ipcRenderer.invoke("runtime:diagnostics"),
  runPlan: (payload) => ipcRenderer.invoke("debate:plan", payload),
  generateExactPreview: (payload) => ipcRenderer.invoke("debate:preview:exact", payload),
  applyPlan: (payload) => ipcRenderer.invoke("debate:apply", payload),
  cancelRun: (payload) => ipcRenderer.invoke("debate:cancel", payload),
  discardPlan: (payload) => ipcRenderer.invoke("debate:discard", payload),
  onRuntimeEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("runtime:event", listener);
    return () => ipcRenderer.off("runtime:event", listener);
  }
});
