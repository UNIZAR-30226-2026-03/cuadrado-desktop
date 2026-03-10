import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { EstadoPartida, Carta } from '../models/game';
import { environment } from '../environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  getGameState(gameId: string): Observable<EstadoPartida> {
    return this.http.get<EstadoPartida>(`${this.baseUrl}/games/${gameId}`);
  }

  playCard(gameId: string, cardId: string): Observable<EstadoPartida> {
    return this.http.post<EstadoPartida>(`${this.baseUrl}/games/${gameId}/play`, { cardId });
  }
}
