import { Injectable, signal, computed } from '@angular/core';
import { WebsocketService } from './websocket';

@Injectable({
  providedIn: 'root'
})
export class GameService {
  private _gameId = signal<string | null>(null);

  gameId = this._gameId.asReadonly();
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

  salirDePartida(): void {
    this.ws.desconectar();
    this._gameId.set(null);
  }
}
