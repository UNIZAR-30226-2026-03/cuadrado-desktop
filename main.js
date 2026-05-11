const { app, BrowserWindow, Menu, session, systemPreferences } = require('electron');
const path = require('path');

// Nombre visible en barra de tareas y alt+tab
app.setName('Cubo');

// Permitir que los <audio> remotos de WebRTC suenen sin necesidad de un gesto previo
// del usuario. Sin esto, en la build empaquetada (file://) Chromium bloquea play()
// y el audio entrante de los compañeros nunca se reproduce.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Chromium ofusca las IPs locales en los ICE candidates con mDNS (`xxx.local`)
// por privacidad. En la build empaquetada de Electron esos hostnames `.local`
// suelen NO resolverse entre máquinas de la misma red → el handshake ICE falla
// y nadie oye a nadie. Desactivar esta feature hace que se publiquen las IPs
// reales de cada interfaz, restaurando el chat de voz P2P.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

// Permitir múltiples rutas de red para que el motor de ICE pruebe todas las
// interfaces (WiFi + Ethernet + VPN), aumentando las probabilidades de cruzar
// el NAT sin necesidad de TURN.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_and_private_interfaces');

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

  // Atajos para abrir DevTools: F12 o Ctrl+Shift+I. Sin esto no hay forma de
  // inspeccionar la consola en la build empaquetada (el menú está oculto).
  win.webContents.on('before-input-event', (event, input) => {
    const isToggleDevtools =
      input.key === 'F12' ||
      (input.control && input.shift && (input.key === 'I' || input.key === 'i'));
    if (isToggleDevtools) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

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
