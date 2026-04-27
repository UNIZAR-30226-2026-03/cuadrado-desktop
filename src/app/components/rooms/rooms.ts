// ═══════════════════════════════════════════════════════════════════════════════
//  Rooms — Pantalla de búsqueda y unión a salas
// ═══════════════════════════════════════════════════════════════════════════════

import { Component, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  trigger, transition, style, animate
} from '@angular/animations';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth';
import { RoomService, SalaData } from '../../services/room';
import { WebsocketService, PublicRoomSummary } from '../../services/websocket';
import { TopBar } from '../shared/top-bar/top-bar';

@Component({
  selector: 'app-rooms',
  standalone: true,
  imports: [TopBar],
  templateUrl: './rooms.html',
  styleUrl: './rooms.scss',
  animations: [
    trigger('cardStagger', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(8px)' }),
        animate('140ms ease-out', style({ opacity: 1, transform: 'none' })),
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
export class Rooms implements OnInit, OnDestroy {
  // Estado
  codigoInput   = signal('');
  errorCodigo   = signal('');
  errorJoin     = signal('');
  busqueda      = signal('');
  refrescando   = signal(false);
  uniendoCodigo = signal(false);
  salas         = signal<SalaData[]>([]);
  cargandoInicial = signal(true);

  readonly skeletonRows = [1, 2, 3, 4];

  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private roomClosedSub: Subscription | null = null;

  // Salas filtradas: solo las que están esperando jugadores
  salasFiltradas = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    // Solo mostrar salas en estado 'esperando' — omitir basura residual
    let lista = this.salas().filter(s => s.estado === 'esperando');
    if (texto) {
      lista = lista.filter(s =>
        s.nombre.toLowerCase().includes(texto) ||
        s.anfitrion.toLowerCase().includes(texto)
      );
    }
    // Ordenar: más jugadores primero, luego más recientes
    return lista.sort((a, b) => {
      if (b.jugadores.length !== a.jugadores.length) return b.jugadores.length - a.jugadores.length;
      return b.creadaEn - a.creadaEn;
    });
  });

  constructor(
    private router: Router,
    private auth: AuthService,
    private roomService: RoomService,
    private ws: WebsocketService
  ) {}

  ngOnInit(): void {
    this.roomService.inicializarSalasMock();
    this.cargarSalas();
    this.refrescando.set(true);

    // Primera carga: reconexión limpia + salir de cualquier sala residual
    // Igual que create-room.ts: conectar → leaveRoomAck → operar
    const iniciarConLimpieza = async () => {
      const token = this.auth.getToken();
      if (token) {
        try {
          this.ws.desconectar();
          await this.ws.conectarYEsperar(token);
          await this.ws.leaveRoomAck(); // limpia userToRoom residual en el backend
        } catch { /* continuar igualmente */ }
      }
      await this.cargarSalasBackend();
    };

    iniciarConLimpieza().finally(() => {
      this.refrescando.set(false);
      this.cargandoInicial.set(false);
    });

    this.refreshInterval = setInterval(() => this.cargarSalasBackend(), 8000);

    // Escuchar cierres de sala en tiempo real — elimina la fila al instante
    this.roomClosedSub = this.ws.roomClosed$.subscribe(({ roomCode }) => {
      this.salas.update(lista => lista.filter(s => s.id !== roomCode));
    });
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.roomClosedSub?.unsubscribe();
  }

  // ═══ Cargar salas locales (mock / localStorage) ═══
  cargarSalas(): void {
    this.salas.set(this.roomService.obtenerSalasPublicas());
  }

  // ═══ Cargar salas reales del backend ═══
  private async cargarSalasBackend(): Promise<void> {
    const token = this.auth.getToken();
    if (!token) return;
    try {
      await this.ws.conectarYEsperar(token);
      const remotas = await this.ws.listPublicRooms();
      // Backend alcanzado: reemplazar completamente (sin mezclar mocks locales)
      this.salas.set(remotas.map(r => this.mapearSalaRemota(r)));
    } catch {
      // Backend no disponible — la lista local permanece como fallback
    }
  }

  private mapearSalaRemota(r: PublicRoomSummary): SalaData {
    const jugadores = Array.from({ length: r.playersCount }, (_, i) => ({
      id: `remote_${r.code}_${i}`,
      nombre: i === 0 ? 'Anfitrión' : `Jugador ${i + 1}`,
      esBot: false,
      esAnfitrion: i === 0,
      avatar: i === 0 ? '👑' : '🎮',
    }));
    return {
      id: r.code,
      nombre: r.name,
      anfitrion: '',
      publica: true,
      estado: 'esperando',
      jugadores,
      dificultadBots: 'Normal',
      creadaEn: new Date(r.createdAt).getTime(),
      numBarajas: (r.rules.deckCount === 2 ? 2 : 1) as 1 | 2,
      maxJugadores: r.rules.maxPlayers,
      reglasActivas: r.rules.enabledPowers ?? [],
    };
  }

  // ═══ Refrescar lista ═══
  refrescar(): void {
    this.refrescando.set(true);
    this.cargarSalasBackend().finally(() => this.refrescando.set(false));
  }

  // ═══ Unirse por código ═══
  onCodigoInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const valor = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6);
    input.value = valor;
    this.codigoInput.set(valor);
    this.errorCodigo.set('');
  }

  async unirsePorCodigo(codigoRaw?: string): Promise<void> {
    if (this.uniendoCodigo()) return;

    const codigo = (codigoRaw ?? this.codigoInput())
      .toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6);
    this.codigoInput.set(codigo);

    if (codigo.length !== 6) {
      this.errorCodigo.set('El código debe tener 6 caracteres');
      return;
    }

    const token = this.auth.getToken();
    if (!token) {
      this.errorCodigo.set('Sesión no válida. Vuelve a iniciar sesión.');
      return;
    }

    try {
      this.errorCodigo.set('');
      this.uniendoCodigo.set(true);

      // Patrón cuadrado-web: conectar → unirse directamente (sin leaveRoomAck)
      await this.ws.conectarYEsperar(token);
      const resp = await this.ws.joinRoomWs(codigo);

      if (!resp.success) {
        this.errorCodigo.set('No se encontró ninguna sala con ese código');
        return;
      }

      this.guardarSalaInvitado(resp.roomCode ?? codigo);
      this.router.navigate(['/waiting-room']);
    } catch {
      this.errorCodigo.set('No se pudo conectar con el servidor');
    } finally {
      this.uniendoCodigo.set(false);
    }
  }

  // ═══ Unirse a sala desde tarjeta ═══
  async unirseDesdeCard(sala: SalaData): Promise<void> {
    try {
      await this.unirseASala(sala);
    } catch {
      this.mostrarErrorJoin('No se pudo unir a la sala. Inténtalo de nuevo.');
    }
  }

  private async unirseASala(sala: SalaData): Promise<void> {
    const token = this.auth.getToken();
    if (!token) {
      this.mostrarErrorJoin('Sesión no válida. Vuelve a iniciar sesión.');
      return;
    }

    await this.ws.conectarYEsperar(token);
    const resultado = await this.ws.joinRoomWs(sala.id);

    if (!resultado.success) {
      this.mostrarErrorJoin('No se pudo unir a la sala. Puede que esté llena o haya comenzado.');
      return;
    }

    this.guardarSalaInvitado(resultado.roomCode ?? sala.id);
    this.router.navigate(['/waiting-room']);
  }

  // Persiste una SalaData mínima para el jugador invitado
  private guardarSalaInvitado(codigo: string): void {
    const usuario = this.auth.usuario();
    const nombreUsuario = usuario?.nombre || 'Jugador';
    const sala: SalaData = {
      id: codigo,
      nombre: `Sala ${codigo}`,
      anfitrion: '',
      publica: true,
      estado: 'esperando',
      jugadores: [{
        id: `user_${nombreUsuario}_${Date.now()}`,
        nombre: nombreUsuario,
        esBot: false,
        esAnfitrion: false,
        avatar: '🎮',
      }],
      dificultadBots: 'Normal',
      creadaEn: Date.now(),
      numBarajas: 1,
      maxJugadores: 8,
      reglasActivas: [],
    };
    this.roomService.guardarSala(sala);
    this.roomService.setEsAnfitrion(false);
  }

  private mostrarErrorJoin(msg: string): void {
    this.errorJoin.set(msg);
    setTimeout(() => this.errorJoin.set(''), 3500);
  }

  // ═══ Búsqueda ═══
  onBusquedaInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.busqueda.set(input.value);
  }

  // Placeholder: el popup de ajustes se implementa en un paso posterior.
  openSettingsFromTopBar(): void {
    this.router.navigate(['/lobby']);
  }

  volver(): void {
    this.router.navigate(['/lobby']);
  }

  irATutorial(): void {
    this.router.navigate(['/tutorial'], { queryParams: { from: 'rooms' } });
  }
}
