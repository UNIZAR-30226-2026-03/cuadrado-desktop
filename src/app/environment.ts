export const environment = {
    production: false,
    apiUrl: 'https://api.alkayata.rocks/api',
    wsUrl: 'https://api.alkayata.rocks',  // Socket.IO usa la raíz, no /ws
    defaultReversoUrl: 'https://gtelrtcunhznrrapfjbj.supabase.co/storage/v1/object/public/cubo-assets/card-skins/ReversoDefault.png',

    // ── TURN/STUN para el chat de voz WebRTC ────────────────────────────────
    // Pega aquí los servidores ICE de tu cuenta metered.ca (50 GB/mes gratis).
    // Pasos:
    //   1. Regístrate en https://dashboard.metered.ca/signup
    //   2. En el dashboard → Tools → TURN Server → "Show ICE Servers"
    //   3. Copia el array JSON que te muestran y pégalo en `iceServers` debajo
    //      (substituye TODO lo que está entre los corchetes [...] del placeholder)
    //
    // Sin un TURN funcional, los compañeros detrás de NAT estricto (Eduroam,
    // 4G, oficinas con firewall) no podrán oírse entre ellos.
    iceServers: [
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:global.relay.metered.ca:80',               username: '8403d1e6953a7652dc5de015', credential: 'jGaspIe9gTcMw6Cg' },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp',  username: '8403d1e6953a7652dc5de015', credential: 'jGaspIe9gTcMw6Cg' },
        { urls: 'turn:global.relay.metered.ca:443',               username: '8403d1e6953a7652dc5de015', credential: 'jGaspIe9gTcMw6Cg' },
        { urls: 'turns:global.relay.metered.ca:443?transport=tcp',username: '8403d1e6953a7652dc5de015', credential: 'jGaspIe9gTcMw6Cg' },
    ] as RTCIceServer[],
}