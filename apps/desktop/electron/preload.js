import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("innoCode", {
  version: "0.2.0",
  pickProject: () => ipcRenderer.invoke("project:pick"),
  runDebate: (payload) => ipcRenderer.invoke("debate:run", payload)
});
