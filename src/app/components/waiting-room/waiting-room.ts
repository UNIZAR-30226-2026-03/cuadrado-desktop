import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth';
import { RoomService, SalaData, JugadorSala } from '../../services/room';
import { WebsocketService, EvRoomUpdate, SavedGameSummary } from '../../services/websocket';
import { GameService } from '../../services/game';
import { VoiceChatService } from '../../services/voice-chat';
import { TopBar } from '../shared/top-bar/top-bar';
import { SettingsPopupComponent } from '../shared/settings-popup/settings-popup';

interface PowerCard {
  card: string;
  description: string;
}

// El backend puede devolver los poderes como índices numéricos (1=A, 2-10=2-10, 11=J, 12=Q, 13=K)
// o directamente como nombres de carta. Esta función normaliza ambos formatos.
const CARTAS_VALIDAS_WR = new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const NUMERO_A_CARTA_WR: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

function normalizarPoderes(poderes: (string | number)[]): string[] {
  return poderes.map(p => {
    if (typeof p === 'string' && CARTAS_VALIDAS_WR.has(p)) return p;
    const n = typeof p === 'number' ? p : parseInt(p as string, 10);
    if (n >= 2 && n <= 10) return String(n);
    return NUMERO_A_CARTA_WR[n] ?? null;
  }).filter((c): c is string => c !== null);
}

const POWER_DESCRIPTIONS: Record<string, string> = {
  'A':  'Intercambia todas tus cartas por todas las cartas de otro jugador.',
  '2':  'Elige a un jugador para que robe una carta extra y la añada a sus cartas.',
  '3':  'Protege una de tus cartas: no puede ser intercambiada por otro jugador.',
  '4':  'Salta el siguiente turno de un jugador a tu elección.',
  '5':  'Mira una carta de cada jugador.',
  '6':  'Roba otra carta del mazo.',
  '7':  'Revela qué jugador tiene menos puntos en ese momento. (Poder almacenable)',
  '8':  'La siguiente habilidad que se active no tendrá efecto. (Poder almacenable)',
  '9':  'Ofrece un intercambio a otro jugador: ambos elegís una carta a ciegas.',
  '10': 'Ve una de tus propias cartas.',
  'J':  'Ve una de tus cartas y una de otro jugador; decide si las intercambias (con ese mismo jugador).',
  'Q':  'Sin poder especial. (12 puntos)',
  'K':  'K roja = 0 puntos · K negra = 20 puntos.',
};

@Component({
  selector: 'app-waiting-room',
  standalone: true,
  imports: [TopBar, SettingsPopupComponent],
  templateUrl: './waiting-room.html',
  styleUrl: './waiting-room.scss',
  animations: [
    trigger('slotStagger', [
      transition(':enter', [
        query('.player-slot', [
          style({ opacity: 0, transform: 'scale(0.9)' }),
          stagger(70, [
            animate('400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              style({ opacity: 1, transform: 'none' })),
          ]),
        ], { optional: true }),
      ]),
    ]),
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(12px)' }),
        animate('350ms ease-out', style({ opacity: 1, transform: 'none' })),
      ]),
    ]),
  ],
})
export class WaitingRoom implements OnInit, OnDestroy {
  sala = signal<SalaData | null>(null);
  soyAnfitrion = signal(false);
  miNombre = signal('');
  iniciandoPartida = signal(false);
  partidaGuardada = signal<SavedGameSummary | null>(null);
  codigoCopiado = signal(false);
  // Popups
  showStartPopup = signal(false);
  showPowersPopup = signal(false);
  showVoiceSettingsPopup = signal(false);
  selectedPowerCard = signal<PowerCard | null>(null);

  private subs: Subscription[] = [];
  private partidaIniciada = false;

  slotsVacios = computed(() => {
    const s = this.sala();
    if (!s) return [];
    const vacios = s.maxJugadores - s.jugadores.length;
    return Array.from({ length: vacios }, (_, i) => i);
  });

  maxBotsAgregables = computed(() => {
    const s = this.sala();
    if (!s) return 0;
    return Math.max(0, s.maxJugadores - s.jugadores.length);
  });

  // IDs de jugadores humanos que aún no se han reconectado en una reanudación
  jugadoresFaltantes = computed((): string[] => {
    const guardada = this.partidaGuardada();
    if (!guardada) return [];
    const sala = this.sala();
    if (!sala) return [];
    const humanosEsperados = guardada.players.filter(id => !id.startsWith('bot'));
    const humanosConectados = new Set(
      sala.jugadores.filter(j => !j.esBot).map(j => j.id)
    );
    return humanosEsperados.filter(id => !humanosConectados.has(id));
  });

  bloqueadoPorReanudacion = computed(() =>
    this.partidaGuardada() !== null && this.jugadoresFaltantes().length > 0
  );

  puedeIniciar = computed(() => {
    const s = this.sala();
    return s != null && s.jugadores.length >= 1 && !this.bloqueadoPorReanudacion();
  });

  puedeJugarConPresentes = computed(() => {
    const s = this.sala();
    return s ? s.jugadores.length >= 2 : false;
  });

  activePowers = computed((): PowerCard[] => {
    const s = this.sala();
    if (!s || !s.reglasActivas) return [];
    return s.reglasActivas.map(card => ({
      card,
      description: POWER_DESCRIPTIONS[card] || 'Poder por definir.',
    }));
  });

  constructor(
    private router: Router,
    private auth: AuthService,
    private roomService: RoomService,
    private ws: WebsocketService,
    private gameService: GameService,
    public voiceChat: VoiceChatService,
  ) {}

  ngOnInit(): void {
    const sala = this.roomService.obtenerSala();
    if (!sala) {
      this.router.navigate(['/lobby']);
      return;
    }
    this.sala.set(sala);
    this.soyAnfitrion.set(this.roomService.esAnfitrion());
    this.miNombre.set(this.auth.usuario()?.nombre || 'Jugador');
    this.partidaGuardada.set(this.roomService.obtenerResumenPartida());

    // Iniciar captura de micrófono y unirse al canal de voz de la sala
    this.voiceChat.startLocalStream(this.voiceChat.selectedDeviceId()).then(() => {
      if (this.ws.estaConectado()) {
        this.voiceChat.joinVoiceRoom(sala.id);
      }
    });

    // Suscribirse a actualizaciones de sala en tiempo real
    this.subs.push(
      this.ws.roomUpdate$.subscribe(state => this.sincronizarDesdeBackend(state)),
      this.ws.roomClosed$.subscribe(() => {
        // El host cerró la sala: volver al lobby
        localStorage.removeItem('cubo_sala_actual');
        localStorage.removeItem('cubo_es_anfitrion');
        this.router.navigate(['/lobby']);
      }),
      this.ws.inicioPartida$.subscribe(ev => {
        this.gameService.setGameId(ev.partidaId);
        this.gameService.setTurnoJugadores(ev.jugadores);
        this.partidaIniciada = true;
        this.router.navigate(['/tablero']);
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.roomService.limpiarResumenPartida();
    if (!this.partidaIniciada && this.ws.estaConectado()) {
      this.ws.leaveRoom();
    }
    if (!this.partidaIniciada) {
      // Sin partida: liberar voz y micrófono completamente
      this.voiceChat.leaveVoiceRoom();
      this.voiceChat.stopLocalStream();
    }
    // Con partida: el stream y las peer connections siguen vivos en el tablero
  }

  // ── Sincronización con backend ───────────────────────────────────────────────

  private sincronizarDesdeBackend(state: EvRoomUpdate): void {
    const sala = this.sala();
    if (!sala) return;
    if (state.code !== sala.id) return;

    // Actualizar nombre del anfitrión
    const nuevoAnfitrion = state.players.find(p => p.isHost)?.userId || sala.anfitrion;

    // Construir lista de jugadores fusionando datos del backend con los locales
    const nuevosJugadores: JugadorSala[] = state.players.map(p => {
      const nombre = p.controlador === 'bot'
        ? (p.nombreEnPartida || `Bot`)
        : p.userId;  // userId === username en el backend
      // Preservar avatar si ya estaba en la sala local
      const existente = sala.jugadores.find(j => j.nombre === nombre);
      return {
        id: p.userId,
        nombre,
        esBot: p.controlador === 'bot',
        esAnfitrion: p.isHost,
        avatar: existente?.avatar || (p.controlador === 'bot' ? '🤖' : '🎮'),
      };
    });

    // Actualizar también maxJugadores si el backend lo conoce
    const maxJugadores = state.rules?.maxPlayers || sala.maxJugadores;

    let estado: 'esperando' | 'llena' | 'en_partida' = 'esperando';
    if (state.started) {
      estado = 'en_partida';
    } else if (nuevosJugadores.length >= maxJugadores) {
      estado = 'llena';
    }

    const numBarajas: 1 | 2 = state.rules?.deckCount === 2 ? 2
      : state.rules?.deckCount === 1 ? 1
      : sala.numBarajas;

    this.sala.set({
      ...sala,
      anfitrion: nuevoAnfitrion,
      jugadores: nuevosJugadores,
      maxJugadores,
      numBarajas,
      estado,
      reglasActivas: state.rules?.enabledPowers?.length
        ? normalizarPoderes(state.rules.enabledPowers as (string | number)[])
        : sala.reglasActivas,
      fillWithBots: (state.rules as any)?.fillWithBots ?? sala.fillWithBots,
    });

    // Persistir en localStorage para que tablero.ts lo pueda leer
    this.roomService.guardarSala(this.sala()!);
  }

  // Copiar codigo
  copiarCodigo(): void {
    const codigo = this.sala()?.id;
    if (!codigo) return;
    navigator.clipboard.writeText(codigo).then(() => {
      this.codigoCopiado.set(true);
      setTimeout(() => this.codigoCopiado.set(false), 2000);
    });
  }

  // Controles del anfitrion
  expulsarJugador(jugador: JugadorSala): void {
    const sala = this.sala();
    if (!sala || !this.soyAnfitrion()) return;
    if (jugador.esAnfitrion) return;

    sala.jugadores = sala.jugadores.filter(j => j.id !== jugador.id);
    if (sala.estado === 'llena') {
      sala.estado = 'esperando';
    }
    this.actualizarSala(sala);
  }

  // Popup de inicio
  abrirPopupInicio(): void {
    if (!this.puedeIniciar() || this.iniciandoPartida()) return;
    if (this.partidaGuardada()) {
      // Si hay una partida guardada pero la sala tiene huecos y está
      // configurada para rellenar con bots, mostrar el popup para
      // permitir elegir rellenar con bots o jugar con presentes.
      const sala = this.sala();
      const huecos = sala ? Math.max(0, sala.maxJugadores - sala.jugadores.length) : 0;
      if (huecos > 0 && sala?.fillWithBots) {
        this.showStartPopup.set(true);
        return;
      }

      // Reanudación: el backend ya sabe qué configuración usar, lanzar directo
      this.lanzarPartida();
    } else {
      this.showStartPopup.set(true);
    }
  }

  cerrarPopupInicio(): void {
    this.showStartPopup.set(false);
  }

  iniciarConPresentes(): void {
    if (!this.puedeJugarConPresentes()) return;
    this.showStartPopup.set(false);
    this.lanzarPartida();
  }

  rellenarConBots(): void {
    const sala = this.sala();
    if (!sala) return;

    const huecos = Math.max(0, sala.maxJugadores - sala.jugadores.length);
    if (huecos <= 0) return;

    const nombresUsados = sala.jugadores.map(j => j.nombre);
    for (let i = 0; i < huecos; i++) {
      const bot = this.roomService.generarBot(nombresUsados, sala.dificultadBots);
      sala.jugadores.push(bot);
      nombresUsados.push(bot.nombre);
    }

    this.actualizarSala(sala);
  }

  private lanzarPartida(): void {
    this.iniciandoPartida.set(true);
    const sala = this.sala();
    if (!sala) return;

    if (this.ws.estaConectado()) {
      // El backend emitirá game:inicio-partida a todos → inicioPartida$ subscription navega
      this.ws.startRoom(sala.id);
    } else {
      // Modo sin conexión: navegación local directa
      setTimeout(() => {
        sala.estado = 'en_partida';
        this.actualizarSala(sala);
        this.router.navigate(['/tablero']);
      }, 2500);
    }
  }

  openSettingsFromTopBar(): void {
    this.showVoiceSettingsPopup.set(true);
  }

  closeVoiceSettings(): void {
    this.showVoiceSettingsPopup.set(false);
  }

  isSpeaking(jugador: JugadorSala): boolean {
    if (jugador.esBot || !this.voiceChat.localStream()) return false;
    if (jugador.nombre === this.miNombre()) return this.voiceChat.localSpeaking();
    const map = this.ws.socketToUsername();
    for (const [socketId, username] of map) {
      if (username === jugador.nombre) return this.voiceChat.speakingPeers().has(socketId);
    }
    return false;
  }

  cancelarSala(): void {
    if (this.ws.estaConectado()) {
      this.ws.leaveRoom();
    }
    this.roomService.eliminarSala();
    this.router.navigate(['/lobby']);
  }

  abandonarSala(): void {
    if (this.ws.estaConectado()) {
      this.ws.leaveRoom();
    }
    const sala = this.sala();
    if (sala) {
      sala.jugadores = sala.jugadores.filter(j => j.nombre !== this.miNombre() || j.esBot);
      if (sala.estado === 'llena') {
        sala.estado = 'esperando';
      }
      if (sala.publica) {
        this.roomService.guardarSala(sala);
      }
    }
    localStorage.removeItem('cubo_sala_actual');
    localStorage.removeItem('cubo_es_anfitrion');
    this.router.navigate(['/lobby']);
  }

  // Popup de poderes
  abrirPopupPoderes(): void {
    this.selectedPowerCard.set(null);
    this.showPowersPopup.set(true);
  }

  cerrarPopupPoderes(): void {
    this.showPowersPopup.set(false);
    this.selectedPowerCard.set(null);
  }

  selectPowerCard(power: PowerCard): void {
    this.selectedPowerCard.set(power);
  }

  // Helpers
  private actualizarSala(sala: SalaData): void {
    this.roomService.guardarSala(sala);
    this.sala.set({ ...sala });
  }

}
