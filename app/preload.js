const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zskin", {
  getState: () => ipcRenderer.invoke("get-state"),
  getStatus: () => ipcRenderer.invoke("get-status"),
  importThemes: () => ipcRenderer.invoke("import-themes"),
  renameTheme: (id, name) => ipcRenderer.invoke("rename-theme", { id, name }),
  removeTheme: id => ipcRenderer.invoke("remove-theme", id),
  setDraft: id => ipcRenderer.invoke("set-draft", id),
  setThemeParams: (id, alpha, position, extra) => ipcRenderer.invoke("set-theme-params", { id, alpha, position, ...(extra || {}) }),
  getAccent: id => ipcRenderer.invoke("get-accent", id),
  chooseZcode: () => ipcRenderer.invoke("choose-zcode"),
  setAppearance: v => ipcRenderer.invoke("set-appearance", v),
  setRotation: patch => ipcRenderer.invoke("set-rotation", patch),
  toggleRotationTheme: id => ipcRenderer.invoke("toggle-rotation-theme", id),
  getZcodeVersion: () => ipcRenderer.invoke("get-zcode-version"),
  checkZcodeUpdate: () => ipcRenderer.invoke("check-zcode-update"),
  enableSkin: targetId => ipcRenderer.invoke("enable-skin", targetId),
  disableSkin: () => ipcRenderer.invoke("restore"),
  openLogs: () => ipcRenderer.invoke("open-logs"),
  setRuntimePrefs: patch => ipcRenderer.invoke("set-runtime-prefs", patch),
  runDiagnostics: () => ipcRenderer.invoke("run-diagnostics"),
});
