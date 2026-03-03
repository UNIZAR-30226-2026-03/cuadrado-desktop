// Servicio centralizado para hablar con el servidor del juego
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { GameState, Card } from '../models';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  // [G]: Inyectamos la herramienta para hacer peticiones
  private http = inject(HttpClient);
  
  // [G]: URL base de tu backend local
  // [G]: Cambia este puerto por el que este usando tu equipo de backend
  private baseUrl = 'http://localhost:8080/api';

  // [G]: Pide al servidor el estado actual de la partida
  getGameState(gameId: string): Observable<GameState> {
    return this.http.get<GameState>(`${this.baseUrl}/games/${gameId}`);
  }

  // [G]: Envia al servidor la accion de jugar una carta
  playCard(gameId: string, cardId: string): Observable<GameState> {
    const payload = { cardId: cardId };
    return this.http.post<GameState>(`${this.baseUrl}/games/${gameId}/play`, payload);
  }
}