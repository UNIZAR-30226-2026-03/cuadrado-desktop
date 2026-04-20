// ═══════════════════════════════════════════════════════════════════════════════
//  Rooms — Pantalla de búsqueda y unión a salas
// ═══════════════════════════════════════════════════════════════════════════════

import { Component, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { RoomService, SalaData, MAX_JUGADORES } from '../../services/room';
import { WebsocketService } from '../../services/websocket';
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
        query('.room-card', [
          style({ opacity: 0, transform: 'translateY(20px) scale(0.96)' }),
          stagger(60, [
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
export class Rooms implements OnInit {
  // Estado
  codigoInput = signal('');
  errorCodigo = signal('');
  busqueda = signal('');
  refrescando = signal(false);
  salas = signal<SalaData[]>([]);

  // Salas filtradas por búsqueda
  salasFiltradas = computed(() => {
    const texto = this.busqueda().toLowerCase().trim();
    let lista = this.salas();
    if (texto) {
      lista = lista.filter(s =>
        s.nombre.toLowerCase().includes(texto) ||
        s.anfitrion.toLowerCase().includes(texto)
      );
    }
    // Ordenar: esperando primero, luego por número de jugadores desc, luego más recientes
    return lista.sort((a, b) => {
      const estadoOrden = { 'esperando': 0, 'en_partida': 1, 'llena': 2 };
      const oa = estadoOrden[a.estado] ?? 3;
      const ob = estadoOrden[b.estado] ?? 3;
      if (oa !== ob) return oa - ob;
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
  }

  // ═══ Cargar salas públicas ═══
  cargarSalas(): void {
    this.salas.set(this.roomService.obtenerSalasPublicas());
  }

  // ═══ Refrescar lista ═══
  refrescar(): void {
    this.refrescando.set(true);
    // Simular latencia de red
    setTimeout(() => {
      this.cargarSalas();
      this.refrescando.set(false);
    }, 800);
  }

  // ═══ Unirse por código ═══
  onCodigoInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Forzar mayúsculas y limitar a 6 caracteres alfanuméricos
    const valor = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6);
    input.value = valor;
    this.codigoInput.set(valor);
    this.errorCodigo.set('');
  }

  unirsePorCodigo(): void {
    const codigo = this.codigoInput().trim().toUpperCase();
    if (codigo.length !== 6) {
      this.errorCodigo.set('El código debe tener 6 caracteres');
      return;
    }

    // Primero buscar en localStorage (salas locales/mock)
    const salaLocal = this.roomService.buscarSalaPorCodigo(codigo);
    if (salaLocal) {
      if (salaLocal.estado === 'en_partida') {
        this.errorCodigo.set('Esta sala ya tiene una partida en curso');
        return;
      }
      if (salaLocal.estado === 'llena' || salaLocal.jugadores.length >= MAX_JUGADORES) {
        this.errorCodigo.set('Esta sala está llena');
        return;
      }
      this.unirseASala(salaLocal);
      return;
    }

    // Si no está en local, intentar unirse al backend directamente por código
    const token = this.auth.getToken();
    if (!token) {
      this.errorCodigo.set('No se encontró ninguna sala con ese código');
      return;
    }

    this.ws.conectarYEsperar(token).then(() => {
      return this.ws.joinRoomWs(codigo);
    }).then(resp => {
      if (!resp.success) {
        this.errorCodigo.set('No se encontró ninguna sala con ese código');
        return;
      }
      // Crear una SalaData mínima para el invitado basada en el código de sala
      const usuario = this.auth.usuario();
      const nombreUsuario = usuario?.nombre || 'Jugador';
      const sala: SalaData = {
        id: codigo,
        nombre: resp.roomCode ? `Sala ${resp.roomCode}` : 'Sala online',
        anfitrion: '',
        publica: true,
        estado: 'esperando',
        jugadores: [{
          id: `user_${nombreUsuario}_${Date.now()}`,
          nombre: nombreUsuario,
          esBot: false,
          esAnfitrion: false,
          listo: false,
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
      this.router.navigate(['/waiting-room']);
    }).catch(() => {
      this.errorCodigo.set('No se encontró ninguna sala con ese código');
    });
  }

  // ═══ Unirse a sala desde tarjeta ═══
  unirseDesdeCard(sala: SalaData): void {
    if (sala.estado !== 'esperando' || sala.jugadores.length >= MAX_JUGADORES) return;
    this.unirseASala(sala);
  }

  private async unirseASala(sala: SalaData): Promise<void> {
    const usuario = this.auth.usuario();
    const nombreUsuario = usuario?.nombre || 'Jugador';
    const token = this.auth.getToken();

    // Unirse a la sala en el backend (para sync multijugador en tiempo real)
    if (token) {
      try {
        await this.ws.conectarYEsperar(token);
        await this.ws.joinRoomWs(sala.id);
        // Si el backend acepta el join, usamos el código de sala tal cual
      } catch {
        // Backend no disponible: continuar con flujo local
      }
    }

    // Evitar duplicados: si el jugador ya esta en la sala, no lo añade de nuevo
    const yaEnSala = sala.jugadores.some(j => !j.esBot && j.nombre === nombreUsuario);
    if (!yaEnSala) {
      const nuevoJugador = {
        id: `user_${nombreUsuario}_${Date.now()}`,
        nombre: nombreUsuario,
        esBot: false,
        esAnfitrion: false,
        listo: false,
        avatar: '🎮'
      };
      sala.jugadores.push(nuevoJugador);

      if (sala.jugadores.length >= MAX_JUGADORES) {
        sala.estado = 'llena';
      }
    }

    this.roomService.guardarSala(sala);
    this.roomService.setEsAnfitrion(false);
    this.router.navigate(['/waiting-room']);
  }

  // ═══ Búsqueda ═══
  onBusquedaInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.busqueda.set(input.value);
  }

  // ═══ Helpers de template ═══
  contarBots(sala: SalaData): number {
    return sala.jugadores.filter(j => j.esBot).length;
  }

  porcentajeOcupacion(sala: SalaData): number {
    return (sala.jugadores.length / MAX_JUGADORES) * 100;
  }

  puedeUnirse(sala: SalaData): boolean {
    return sala.estado === 'esperando' && sala.jugadores.length < MAX_JUGADORES;
  }

  avatarAnfitrion(sala: SalaData): string {
    const host = sala.jugadores.find(j => j.esAnfitrion);
    return host?.avatar || '👤';
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
