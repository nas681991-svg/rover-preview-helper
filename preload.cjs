const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  launchRecorder: (mode) => ipcRenderer.invoke('launch-recorder', mode),
  listRecords: () => ipcRenderer.invoke('list-records'),
  readRecord: (filePath) => ipcRenderer.invoke('read-record', filePath)
});
