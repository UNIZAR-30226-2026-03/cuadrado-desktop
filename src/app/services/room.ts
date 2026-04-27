// ═══════════════════════════════════════════════════════════════════════════════
//  RoomService — Gestión del sistema de salas (localStorage)
// ═══════════════════════════════════════════════════════════════════════════════

import { Injectable } from '@angular/core';

// ═══ Interfaces ═══

export interface JugadorSala {
  id: string;
  nombre: string;
  esBot: boolean;
  esAnfitrion: boolean;
  dificultad?: 'Fácil' | 'Normal' | 'Difícil';
  avatar: string;
}

export const MAX_JUGADORES = 8;

export interface SalaData {
  id: string;
  nombre: string;
  anfitrion: string;
  publica: boolean;
  estado: 'esperando' | 'en_partida' | 'llena';
  jugadores: JugadorSala[];
  dificultadBots: 'Fácil' | 'Normal' | 'Difícil';
  creadaEn: number;
  numBarajas: 1 | 2;
  maxJugadores: number;
  reglasActivas: string[];  // e.g. ['A', '3', '7']
}

// Nombres y avatares para bots
const BOT_ANIMALES = [
  'Águila', 'Zorro', 'Lobo', 'Halcón', 'Tigre', 'Cobra',
  'Búho', 'Jaguar', 'Fénix', 'Dragón', 'Cuervo', 'León',
  'Pantera', 'Víbora', 'Grifo', 'Kraken'
];

const BOT_AVATARES: Record<string, string> = {
  'Águila': '🦅', 'Zorro': '🦊', 'Lobo': '🐺', 'Halcón': '🦤',
  'Tigre': '🐯', 'Cobra': '🐍', 'Búho': '🦉', 'Jaguar': '🐆',
  'Fénix': '🔥', 'Dragón': '🐉', 'Cuervo': '🐦‍⬛', 'León': '🦁',
  'Pantera': '🐾', 'Víbora': '🐍', 'Grifo': '🦅', 'Kraken': '🐙'
};

@Injectable({ providedIn: 'root' })
export class RoomService {
  private readonly SALA_KEY = 'cubo_sala_actual';
  private readonly SALAS_KEY = 'cubo_salas_publicas';
  private readonly ES_ANFITRION_KEY = 'cubo_es_anfitrion';

  private normalizarJugador(raw: any, index: number): JugadorSala {
    const esBot = !!raw?.esBot;
    return {
      id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id : `jugador_${index}`,
      nombre:
        typeof raw?.nombre === 'string' && raw.nombre.trim()
          ? raw.nombre
          : (esBot ? `Bot_${index + 1}` : `Jugador ${index + 1}`),
      esBot,
      esAnfitrion: !!raw?.esAnfitrion,
      dificultad: raw?.dificultad,
      avatar: typeof raw?.avatar === 'string' && raw.avatar ? raw.avatar : (esBot ? '🤖' : '🎮'),
    };
  }

  private normalizarSala(raw: any): SalaData {
    const jugadoresRaw = Array.isArray(raw?.jugadores) ? raw.jugadores : [];
    const jugadores = jugadoresRaw.map((j: any, i: number) => this.normalizarJugador(j, i));

    const maxJugadores =
      typeof raw?.maxJugadores === 'number' && raw.maxJugadores > 0
        ? raw.maxJugadores
        : MAX_JUGADORES;

    const estadoRaw = raw?.estado;
    let estado: 'esperando' | 'en_partida' | 'llena' =
      estadoRaw === 'esperando' || estadoRaw === 'en_partida' || estadoRaw === 'llena'
        ? estadoRaw
        : 'esperando';

    if (estado !== 'en_partida' && jugadores.length >= maxJugadores) {
      estado = 'llena';
    }

    return {
      id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id : `ROOM_${Date.now()}`,
      nombre: typeof raw?.nombre === 'string' ? raw.nombre : 'Sala',
      anfitrion: typeof raw?.anfitrion === 'string' ? raw.anfitrion : '',
      publica: raw?.publica !== false,
      estado,
      jugadores,
      dificultadBots: raw?.dificultadBots === 'Fácil' || raw?.dificultadBots === 'Difícil' ? raw.dificultadBots : 'Normal',
      creadaEn: typeof raw?.creadaEn === 'number' ? raw.creadaEn : Date.now(),
      numBarajas: raw?.numBarajas === 2 ? 2 : 1,
      maxJugadores,
      reglasActivas: Array.isArray(raw?.reglasActivas)
        ? raw.reglasActivas.filter((r: unknown) => typeof r === 'string')
        : [],
    };
  }

  // ═══ Generación de código único de 6 caracteres ═══
  generarCodigo(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 6; i++) {
      codigo += chars[Math.floor(Math.random() * chars.length)];
    }
    const salas = this.obtenerSalasPublicas();
    if (salas.some(s => s.id === codigo)) {
      return this.generarCodigo();
    }
    return codigo;
  }

  // ═══ Generación de bot ═══
  generarBot(nombresUsados: string[] = [], dificultad: 'Fácil' | 'Normal' | 'Difícil' = 'Normal'): JugadorSala {
    const disponibles = BOT_ANIMALES.filter(n => !nombresUsados.includes(`Bot_${n}`));
    const animal = disponibles.length > 0
      ? disponibles[Math.floor(Math.random() * disponibles.length)]
      : BOT_ANIMALES[Math.floor(Math.random() * BOT_ANIMALES.length)];

    return {
      id: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      nombre: `Bot_${animal}`,
      esBot: true,
      esAnfitrion: false,
      dificultad,
      avatar: BOT_AVATARES[animal] || '🤖'
    };
  }

  // ═══ CRUD sala actual ═══
  guardarSala(sala: SalaData): void {
    localStorage.setItem(this.SALA_KEY, JSON.stringify(sala));
    if (sala.publica) {
      this.actualizarEnListaPublica(sala);
    }
  }

  obtenerSala(): SalaData | null {
    const data = localStorage.getItem(this.SALA_KEY);
    if (!data) return null;

    try {
      return this.normalizarSala(JSON.parse(data));
    } catch {
      return null;
    }
  }

  eliminarSala(): void {
    const sala = this.obtenerSala();
    if (sala) {
      this.eliminarDeListaPublica(sala.id);
    }
    localStorage.removeItem(this.SALA_KEY);
    localStorage.removeItem(this.ES_ANFITRION_KEY);
  }

  setEsAnfitrion(valor: boolean): void {
    localStorage.setItem(this.ES_ANFITRION_KEY, JSON.stringify(valor));
  }

  esAnfitrion(): boolean {
    return JSON.parse(localStorage.getItem(this.ES_ANFITRION_KEY) || 'false');
  }

  // ═══ Lista de salas públicas ═══
  obtenerSalasPublicas(): SalaData[] {
    const data = localStorage.getItem(this.SALAS_KEY);
    if (!data) return [];

    try {
      const parsed = JSON.parse(data);
      const lista = Array.isArray(parsed) ? parsed : [];
      const normalizadas = lista.map(s => this.normalizarSala(s));
      localStorage.setItem(this.SALAS_KEY, JSON.stringify(normalizadas));
      return normalizadas;
    } catch {
      return [];
    }
  }

  private actualizarEnListaPublica(sala: SalaData): void {
    const salas = this.obtenerSalasPublicas();
    const idx = salas.findIndex(s => s.id === sala.id);
    if (idx >= 0) {
      salas[idx] = sala;
    } else {
      salas.push(sala);
    }
    localStorage.setItem(this.SALAS_KEY, JSON.stringify(salas));
  }

  private eliminarDeListaPublica(id: string): void {
    const salas = this.obtenerSalasPublicas().filter(s => s.id !== id);
    localStorage.setItem(this.SALAS_KEY, JSON.stringify(salas));
  }

  buscarSalaPorCodigo(codigo: string): SalaData | null {
    const publica = this.obtenerSalasPublicas().find(s => s.id === codigo);
    if (publica) return publica;
    const actual = this.obtenerSala();
    if (actual && actual.id === codigo) return actual;
    return null;
  }

  // ═══ Datos simulados (6 salas de ejemplo) ═══
  inicializarSalasMock(): void {
    const existentes = this.obtenerSalasPublicas();
    if (existentes.length > 0) return;

    const ahora = Date.now();
    const mockSalas: SalaData[] = [
      {
        id: 'XK7M2P', nombre: 'Sala del Rey', anfitrion: 'Carlos_PRO',
        publica: true, estado: 'esperando',
        dificultadBots: 'Normal', creadaEn: ahora - 120000,
        numBarajas: 1, maxJugadores: 8, reglasActivas: ['A', '3'],
        jugadores: [
          { id: 'u1', nombre: 'Carlos_PRO', esBot: false, esAnfitrion: true, avatar: '😎' },
          { id: 'u2', nombre: 'MariaLuz', esBot: false, esAnfitrion: false, avatar: '🌟' }
        ]
      },
      {
        id: 'AB3N9W', nombre: 'Partida rápida', anfitrion: 'Jugador_X',
        publica: true, estado: 'esperando',
        dificultadBots: 'Fácil', creadaEn: ahora - 60000,
        numBarajas: 1, maxJugadores: 4, reglasActivas: [],
        jugadores: [
          { id: 'u3', nombre: 'Jugador_X', esBot: false, esAnfitrion: true, avatar: '🎮' },
          { id: 'b1', nombre: 'Bot_Águila', esBot: true, esAnfitrion: false, dificultad: 'Fácil', avatar: '🦅' },
          { id: 'b2', nombre: 'Bot_Zorro', esBot: true, esAnfitrion: false, dificultad: 'Fácil', avatar: '🦊' }
        ]
      },
      {
        id: 'QR5TL8', nombre: 'Torneo de ases', anfitrion: 'ProGamer99',
        publica: true, estado: 'en_partida',
        dificultadBots: 'Difícil', creadaEn: ahora - 300000,
        numBarajas: 2, maxJugadores: 4, reglasActivas: ['A', '3', '7', '10'],
        jugadores: [
          { id: 'u4', nombre: 'ProGamer99', esBot: false, esAnfitrion: true, avatar: '🏆' },
          { id: 'u5', nombre: 'NovaCraft', esBot: false, esAnfitrion: false, avatar: '🚀' },
          { id: 'u6', nombre: 'ElMago42', esBot: false, esAnfitrion: false, avatar: '🧙' },
          { id: 'b3', nombre: 'Bot_Tigre', esBot: true, esAnfitrion: false, dificultad: 'Difícil', avatar: '🐯' }
        ]
      },
      {
        id: 'MN4H7K', nombre: 'Sala chill', anfitrion: 'Luna_22',
        publica: true, estado: 'esperando',
        dificultadBots: 'Normal', creadaEn: ahora - 45000,
        numBarajas: 1, maxJugadores: 6, reglasActivas: ['A'],
        jugadores: [
          { id: 'u7', nombre: 'Luna_22', esBot: false, esAnfitrion: true, avatar: '🌙' }
        ]
      },
      {
        id: 'WP8G3R', nombre: 'Los imparables', anfitrion: 'DarkKnight',
        publica: true, estado: 'llena',
        dificultadBots: 'Normal', creadaEn: ahora - 180000,
        numBarajas: 2, maxJugadores: 4, reglasActivas: ['A', '3', '7'],
        jugadores: [
          { id: 'u8', nombre: 'DarkKnight', esBot: false, esAnfitrion: true, avatar: '🦇' },
          { id: 'u9', nombre: 'SolNaciente', esBot: false, esAnfitrion: false, avatar: '☀️' },
          { id: 'u10', nombre: 'AceDeEspadas', esBot: false, esAnfitrion: false, avatar: '♠️' },
          { id: 'b4', nombre: 'Bot_León', esBot: true, esAnfitrion: false, dificultad: 'Normal', avatar: '🦁' }
        ]
      },
      {
        id: 'FJ2V5D', nombre: 'Novatos welcome', anfitrion: 'Principiante1',
        publica: true, estado: 'esperando',
        dificultadBots: 'Fácil', creadaEn: ahora - 30000,
        numBarajas: 1, maxJugadores: 6, reglasActivas: [],
        jugadores: [
          { id: 'u11', nombre: 'Principiante1', esBot: false, esAnfitrion: true, avatar: '🐣' },
          { id: 'u12', nombre: 'NuevoJugador', esBot: false, esAnfitrion: false, avatar: '🎲' },
          { id: 'b5', nombre: 'Bot_Búho', esBot: true, esAnfitrion: false, dificultad: 'Fácil', avatar: '🦉' },
          { id: 'b6', nombre: 'Bot_Lobo', esBot: true, esAnfitrion: false, dificultad: 'Fácil', avatar: '🐺' }
        ]
      }
    ];

    localStorage.setItem(this.SALAS_KEY, JSON.stringify(mockSalas));
  }
}
