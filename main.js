const { app, BrowserWindow, Menu, session, systemPreferences } = require('electron');
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

app.whenReady().then(async () => {
  // En macOS hay que pedir explícitamente acceso al micrófono al SO. En Windows
  // el sistema gestiona el permiso de forma global y `askForMediaAccess` no
  // existe, así que nos saltamos esta llamada.
  if (process.platform === 'darwin' && systemPreferences?.askForMediaAccess) {
    try {
      await systemPreferences.askForMediaAccess('microphone');
    } catch {
      // Si falla seguimos: el handler de permisos abajo permite que el motor
      // de Chromium no bloquee la petición; el SO mostrará su propio prompt.
    }
  }

  // Concede acceso al micrófono cuando getUserMedia lo solicita desde el render.
  // Sin esto, Electron deniega 'media' silenciosamente y el chat de voz no
  // captura audio (síntoma: nadie oye al usuario de la app de escritorio).
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'audioCapture';
  });

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
