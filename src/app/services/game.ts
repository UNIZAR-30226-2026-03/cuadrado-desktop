import { Injectable, signal, computed } from '@angular/core';
import { WebsocketService, AccionJuego } from './websocket';
import { EstadoPartida, Jugador, Carta } from '../models/game';

@Injectable({
  providedIn: 'root'
})
export class GameService {
  // Señales reactivas: si cambian, la pantalla se actualiza sola
  private _estado = signal<EstadoPartida | null>(null);
  private _jugadores = signal<Jugador[]>([]); // Mantenemos los jugadores aquí

  // Variables públicas de solo lectura para que las lea el componente HTML
  estado = this._estado.asReadonly();
  jugadores = this._jugadores.asReadonly();
  fase = computed(() => this._estado()?.fase ?? 'waiting');

  constructor(private ws: WebsocketService) {
    // Escuchamos el estado que llega del servidor
    this.ws.estadoPartida$.subscribe(nuevoEstado => {
      this._estado.set(nuevoEstado);
      // Aquí en un futuro el backend enviará también los jugadores en el estado
    });
  }

  // --- MÉTODOS DE RED ---
  unirseAPartida(salaId: string): void {
    const tokenFalso = 'token-temporal-123';
    this.ws.conectar(tokenFalso, salaId);
  }

  robarDelMazo(): void { this.ws.enviarAccion({ tipo: 'robar_mazo' }); }
  robarDelDescarte(): void { this.ws.enviarAccion({ tipo: 'robar_descarte' }); }
  descartarCarta(cartaId: string): void { this.ws.enviarAccion({ tipo: 'descartar', cartaId }); }
  decirCuadrado(): void { this.ws.enviarAccion({ tipo: 'decir_cuadrado' }); }
  
  salirDePartida(): void {
    this.ws.desconectar();
    this._estado.set(null);
    this._jugadores.set([]);
  }

  // --- MOCK PARA DESARROLLO (Para poder programar la vista sin backend) ---
  cargarPartidaMock(): void {
    const palos: ('hearts' | 'diamonds' | 'clubs' | 'spades')[] = ['hearts', 'diamonds', 'clubs', 'spades'];
    const valores = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    
    const cartaAzar = (visible = false): Carta => ({
      palo: palos[Math.floor(Math.random() * 4)],
      valor: valores[Math.floor(Math.random() * 13)],
      estaVisible: visible
    });

    const jugadoresFalsos: Jugador[] = [
      { id: 1, idUsuario: 101, cartas: [cartaAzar(), cartaAzar(), cartaAzar(), cartaAzar()], estaSilenciado: false, estaEnsordecido: false },
      { id: 2, idUsuario: 102, cartas: [cartaAzar(), cartaAzar(), cartaAzar(), cartaAzar()], estaSilenciado: false, estaEnsordecido: false },
      { id: 3, idUsuario: 103, cartas: [cartaAzar(), cartaAzar(), cartaAzar(), cartaAzar()], estaSilenciado: false, estaEnsordecido: false },
      { id: 4, idUsuario: 104, cartas: [cartaAzar(), cartaAzar(), cartaAzar(), cartaAzar()], estaSilenciado: false, estaEnsordecido: false }
    ];

    this._jugadores.set(jugadoresFalsos);

    this._estado.set({
      idSala: 'sala-1',
      turnoActual: 1,
      cartasRestantes: [],
      ultimoDescarte: cartaAzar(true),
      tiempoRestante: 30,
      fase: 'playing',
      jugadorCubo: 0
    });
  }
}