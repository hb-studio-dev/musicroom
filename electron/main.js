
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const isDev = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_START_URL;
    mainWindow.loadURL(url);
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '../renderer/dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => (mainWindow = null));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC: audio processing stubs (split by domain) ---
ipcMain.handle('audio:format', async (event, payload) => {
  // TODO: implement ffmpeg-based formatting (decode/encode, resample)
  return { ok: false, message: 'format() not implemented yet' };
});

ipcMain.handle('audio:separate', async (event, payload) => {
  // TODO: replace with MVSEP-MDX23 pipeline (onnxruntime-node)
  return { ok: false, message: 'separate() not implemented yet (MVSEP-MDX23 planned)' };
});

ipcMain.handle('audio:timePitch', async (event, payload) => {
  // TODO: implement offline time-stretch / pitch-shift (e.g., soundtouch, rubberband)
  return { ok: false, message: 'timePitch() not implemented yet' };
});


// Import modules
const { formatAudio } = require('./audio/format/index.js');
const { separateMVSEP } = require('./audio/separate/mvsep-mdx23.js');
const { timePitch } = require('./audio/timepitch/index.js');

// Rewire IPC to call modules
ipcMain.removeHandler('audio:format');
ipcMain.handle('audio:format', async (_event, payload) => {
  return await formatAudio(payload);
});
ipcMain.removeHandler('audio:separate');
ipcMain.handle('audio:separate', async (_event, payload) => {
  return await separateMVSEP(payload);
});
ipcMain.removeHandler('audio:timePitch');
ipcMain.handle('audio:timePitch', async (_event, payload) => {
  return await timePitch(payload);
});
