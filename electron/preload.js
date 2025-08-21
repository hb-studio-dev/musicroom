
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicroom', {
  audio: {
    format: (opts) => ipcRenderer.invoke('audio:format', opts),
    separate: (opts) => ipcRenderer.invoke('audio:separate', opts),
    timePitch: (opts) => ipcRenderer.invoke('audio:timePitch', opts),
  },
  dialog: {
    openFile: async (filters) => {
      const result = await ipcRenderer.invoke('dialog:openFile', filters);
      return result;
    }
  }
});

// Relay for file dialogs (optional)
const { dialog } = require('electron');
ipcRenderer.handle('dialog:openFile', async (_e, filters) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: filters || [{ name: 'Audio', extensions: ['wav','mp3','flac','m4a','ogg'] }]
  });
  return canceled ? null : filePaths[0];
});
