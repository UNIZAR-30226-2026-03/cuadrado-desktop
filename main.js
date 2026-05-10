const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Nombre visible en barra de tareas y alt+tab
app.setName('Cubo');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    show: false,            // Se muestra solo cuando está listo (sin flash blanco)
    frame: true,
    icon: path.join(__dirname, 'public', 'logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Eliminar la barra de menú por completo (Archivo, Editar, Ver...)
  Menu.setApplicationMenu(null);

  win.loadFile(path.join(__dirname, 'dist', 'cuadrado-app', 'browser', 'index.html'));

  // Mostrar la ventana cuando el contenido está renderizado (evita pantalla blanca)
  win.once('ready-to-show', () => {
    win.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
