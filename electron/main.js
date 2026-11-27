const { app, BrowserWindow } = require('electron');

const DEFAULT_APP_URL = 'http://localhost:8787/?desktop=1';
const WM_NCLBUTTONDBLCLK = 0x00a3;

function createPetWindow() {
  const mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    minWidth: 260,
    minHeight: 240,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'floating');

  // Windows 下 -webkit-app-region: drag 會將雙擊轉為非客戶區訊息 WM_NCLBUTTONDBLCLK，
  // 攔截該訊息並轉發給前端 window.togglePetChatPanel() 以支援雙擊立繪展開／收合對話面板
  if (process.platform === 'win32') {
    mainWindow.hookWindowMessage(WM_NCLBUTTONDBLCLK, () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents
          .executeJavaScript('window.togglePetChatPanel && window.togglePetChatPanel();')
          .catch(() => {});
      }
    });
  }

  const targetUrl = (process.env.PET_APP_URL || DEFAULT_APP_URL).trim();
  mainWindow.loadURL(targetUrl);

  return mainWindow;
}

app.whenReady().then(() => {
  createPetWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPetWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
