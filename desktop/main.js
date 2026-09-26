/* Sand and Ink — desktop shell (Electron)
 *
 * Loads the bundled offline web app (app/index.html) in a plain window.
 * No network access, no auto-update, nothing stored outside the window.
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 640,
    minHeight: 420,
    title: 'Sand and Ink',
    backgroundColor: '#efeae0',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.loadFile(path.join(__dirname, 'app', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
