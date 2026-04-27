import { Injectable, signal, computed } from '@angular/core';
import { WebsocketService } from './websocket';

@Injectable({
  providedIn: 'root'
})
export class GameService {
  private _gameId = signal<string | null>(null);
  private _turnoJugadores = signal<string[]>([]);

  gameId = this._gameId.asReadonly();
  turnoJugadores = this._turnoJugadores.asReadonly();
  estaConectado = computed(() => this.ws.estaConectado());

  constructor(private ws: WebsocketService) {}

  unirseAPartida(token: string, roomCode: string): void {
    this.ws.conectar(token, roomCode);
  }

  iniciarPartida(): void {
    this.ws.iniciarPartida();
  }

  robarCarta(): void {
    const id = this._gameId();
    if (id) this.ws.robarCarta(id);
  }

  descartarPendiente(): void {
    const id = this._gameId();
    if (id) this.ws.descartarPendiente(id);
  }

  intercambiarConPendiente(numCarta: number): void {
    const id = this._gameId();
    if (id) this.ws.cartaPorPendiente(id, numCarta);
  }

  solicitarCubo(): void {
    const id = this._gameId();
    if (id) this.ws.solicitarCubo(id);
  }

  setGameId(gameId: string): void {
    this._gameId.set(gameId);
  }

  setTurnoJugadores(jugadores: string[]): void {
    this._turnoJugadores.set(jugadores);
  }

  salirDePartida(): void {
    this.ws.desconectar();
    this._gameId.set(null);
    this._turnoJugadores.set([]);
  }
}
