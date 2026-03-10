import { Injectable, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import { environment } from '../environment';
// Importamos los modelos que ya tienes en tu game.ts
import { EstadoPartida } from '../models/game'; 

// Definimos un tipo básico para las acciones hasta que unifiquéis modelos
export type AccionJuego = 
  | { tipo: 'robar_mazo' }
  | { tipo: 'robar_descarte' }
  | { tipo: 'descartar'; cartaId: string }
  | { tipo: 'intercambiar'; cartaPropiaIdx: number }
  | { tipo: 'decir_cuadrado' };

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private socket: Socket | null = null;

  // Señal reactiva para saber si estamos conectados
  estaConectado = signal(false);

  // Canales de comunicación (Subjects) para que los componentes se suscriban
  estadoPartida$ = new Subject<EstadoPartida>();
  mensajeChat$ = new Subject<{ jugadorId: string; texto: string; timestamp: number }>();
  error$ = new Subject<string>();

  constructor() { }

  conectar(token: string, salaId: string): void {
    // Si ya estamos conectados, no hacemos nada
    if (this.socket?.connected) return;

    // Iniciamos la conexión con el servidor
    this.socket = io(environment.wsUrl, {
      auth: { token },
      query: { salaId },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    // Escuchamos eventos básicos del sistema
    this.socket.on('connect', () => this.estaConectado.set(true));
    this.socket.on('disconnect', () => this.estaConectado.set(false));

    // Escuchamos el evento principal del juego: cuando el servidor manda el estado de la mesa
    this.socket.on('estado_partida', (estado: EstadoPartida) => {
      this.estadoPartida$.next(estado);
    });

    // Escuchamos otros eventos
    this.socket.on('mensaje_chat', (msg) => this.mensajeChat$.next(msg));
    this.socket.on('error', (err) => this.error$.next(err));
  }

  // Método para que tu Tablero envíe jugadas al servidor
  enviarAccion(accion: AccionJuego): void {
    if (this.socket?.connected) {
      this.socket.emit('accion_juego', accion);
    }
  }

  // Método para enviar mensajes por el chat
  enviarMensaje(texto: string): void {
    if (this.socket?.connected) {
      this.socket.emit('mensaje_chat', { texto });
    }
  }

  // Método para salir de la partida
  desconectar(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.estaConectado.set(false);
    }
  }
}