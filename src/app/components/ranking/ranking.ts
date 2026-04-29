import { Component, OnInit, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../services/auth';
import { TopBar } from '../shared/top-bar/top-bar';
import { SettingsPopupComponent } from '../shared/settings-popup/settings-popup';
import { environment } from '../../environment';

interface LeaderboardRow {
  position: number;
  username: string;
  eloRating: number;
}

interface MyPosition {
  username: string;
  eloRating: number;
  position: number;
}

@Component({
  selector: 'app-ranking',
  standalone: true,
  imports: [TopBar, SettingsPopupComponent],
  templateUrl: './ranking.html',
  styleUrl: './ranking.scss',
})
export class Ranking implements OnInit {
  topUsers = signal<LeaderboardRow[]>([]);
  myPosition = signal<MyPosition | null>(null);
  loading = signal(true);
  loadError = signal<string | null>(null);

  readonly limit = 20;

  isMe = computed(() => (row: LeaderboardRow) =>
    this.auth.usuario()?.nombre === row.username
  );

  constructor(
    protected auth: AuthService,
    private router: Router,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.http.get<LeaderboardRow[]>(`${environment.apiUrl}/users/top?limit=${this.limit}`).subscribe({
      next: (rows) => {
        this.topUsers.set(rows ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('No se pudo cargar el ranking.');
        this.loading.set(false);
      },
    });

    const token = this.auth.getToken();
    if (token) {
      const headers = { Authorization: `Bearer ${token}` };
      this.http.get<MyPosition>(`${environment.apiUrl}/users/me/position`, { headers }).subscribe({
        next: (p) => this.myPosition.set(p),
        error: () => this.myPosition.set(null),
      });
    }
  }

  esYo(row: LeaderboardRow): boolean {
    return this.auth.usuario()?.nombre === row.username;
  }

  medalla(position: number): string {
    if (position === 1) return '🥇';
    if (position === 2) return '🥈';
    if (position === 3) return '🥉';
    return '';
  }

  volver(): void { this.router.navigate(['/lobby']); }
  showSettingsPopup = false;
  openSettingsFromTopBar(): void { this.showSettingsPopup = true; }
}
