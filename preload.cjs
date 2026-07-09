const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  launchRecorder: (mode) => ipcRenderer.invoke('launch-recorder', mode),
  listRecords: () => ipcRenderer.invoke('list-records'),
  readRecord: (filePath) => ipcRenderer.invoke('read-record', filePath),
  extractPdf: (base64, filename) => ipcRenderer.invoke('extract-pdf', base64, filename)
});
