const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  launchRecorder: () => ipcRenderer.invoke('launch-recorder'),
  listRecords: () => ipcRenderer.invoke('list-records'),
  readRecord: (filePath) => ipcRenderer.invoke('read-record', filePath)
});
