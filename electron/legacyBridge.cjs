const { contextBridge, ipcRenderer } = require("electron");

// No arbitrary IPC, filesystem paths, network destinations or script execution
// are exposed to the renderer.
contextBridge.exposeInMainWorld("synapseLegacyStorage", {
  list: () => ipcRenderer.invoke("synapse:legacy-storage", "list"),
  audio: (id) => ipcRenderer.invoke("synapse:legacy-storage", "audio", id),
});
