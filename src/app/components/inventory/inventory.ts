import { Component, OnInit, signal, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  trigger, transition, style, animate, query, stagger
} from '@angular/animations';
import { AuthService } from '../../services/auth';
import { environment } from '../../environment';

interface Skin {
  id: string;
  name: string;
  type: string;
  price: number;
  url: string;
}

type Rarity = 'Comun' | 'Rara' | 'Epica' | 'Legendaria';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './inventory.html',
  styleUrl: './inventory.scss',
  animations: [
    trigger('gridStagger', [
      transition(':enter', [
        query('.inv-card', [
          style({ opacity: 0, transform: 'translateY(24px) scale(0.95)' }),
          stagger(50, [
            animate('400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              style({ opacity: 1, transform: 'none' })),
          ]),
        ], { optional: true }),
      ]),
    ]),
  ],
})
export class Inventory implements OnInit {
  // Estado
  imgFailed = signal<Set<string>>(new Set());
  ownedSkins = signal<Skin[]>([]);
  equippedCardName = signal<string | null>(null);
  equippedTapeteName = signal<string | null>(null);
  activeTab = signal<'Carta' | 'Tapete'>('Carta');
  loading = signal(true);

  // Computed
  filteredSkins = computed(() => {
    return this.ownedSkins().filter(s => s.type === this.activeTab());
  });

  equippedCard = computed(() => {
    const eq = this.equippedCardName();
    return this.ownedSkins().find(s => s.type === 'Carta' && s.name === eq) || null;
  });

  equippedMat = computed(() => {
    const eq = this.equippedTapeteName();
    return this.ownedSkins().find(s => s.type === 'Tapete' && s.name === eq) || null;
  });

  totalItems = computed(() => this.ownedSkins().length);

  rarestItem = computed(() => {
    const skins = this.ownedSkins();
    if (!skins.length) return null;
    return skins.reduce((max, s) => s.price > max.price ? s : max, skins[0]);
  });

  totalCards = computed(() => this.ownedSkins().filter(s => s.type === 'Carta').length);
  totalMats = computed(() => this.ownedSkins().filter(s => s.type === 'Tapete').length);

  constructor(
    protected auth: AuthService,
    private router: Router,
    private http: HttpClient,
  ) {}

  get usuario() { return this.auth.usuario(); }

  ngOnInit() {
    this.loadInventory();
  }

  private loadInventory() {
    this.loading.set(true);
    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };

    this.http.get<Skin[]>(`${environment.apiUrl}/skins/inventory`, { headers }).subscribe({
      next: (skins) => {
        // Filtrar solo Carta y Tapete
        this.ownedSkins.set(skins.filter(s => s.type === 'Carta' || s.type === 'Tapete'));
        if (this.usuario) {
          this.equippedCardName.set(this.usuario.reverso || null);
          this.equippedTapeteName.set(this.usuario.tapete || null);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Navegación
  goBack() { this.router.navigate(['/lobby']); }
  goToShop() { this.router.navigate(['/shop']); }

  // Pestañas
  setTab(tab: 'Carta' | 'Tapete') { this.activeTab.set(tab); }

  // Rareza
  getRarity(price: number): Rarity {
    if (price <= 150) return 'Comun';
    if (price <= 350) return 'Rara';
    if (price <= 550) return 'Epica';
    return 'Legendaria';
  }

  getRarityLabel(price: number): string {
    const r = this.getRarity(price);
    if (r === 'Comun') return 'Común';
    if (r === 'Epica') return 'Épica';
    return r;
  }

  getRarityClass(price: number): string {
    return 'rarity--' + this.getRarity(price).toLowerCase();
  }

  isEquipped(skin: Skin): boolean {
    if (skin.type === 'Carta') return this.equippedCardName() === skin.name;
    if (skin.type === 'Tapete') return this.equippedTapeteName() === skin.name;
    return false;
  }

  equipSkin(skin: Skin) {
    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };
    this.http.patch<any>(`${environment.apiUrl}/skins/equip/${skin.id}`, {}, { headers }).subscribe({
      next: () => {
        if (skin.type === 'Carta') {
          this.equippedCardName.set(skin.name);
          if (this.usuario) {
            const updated = { ...this.usuario, reverso: skin.name };
            localStorage.setItem('usuario', JSON.stringify(updated));
            (this.auth as any)._usuario.set(updated);
          }
        } else if (skin.type === 'Tapete') {
          this.equippedTapeteName.set(skin.name);
          if (this.usuario) {
            const updated = { ...this.usuario, tapete: skin.name };
            localStorage.setItem('usuario', JSON.stringify(updated));
            (this.auth as any)._usuario.set(updated);
          }
        }
      },
    });
  }

  unequipSkin(type: string) {
    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };
    this.http.patch<any>(`${environment.apiUrl}/skins/unequip/${type}`, {}, { headers }).subscribe({
      next: () => {
        if (type === 'Carta') {
          this.equippedCardName.set(null);
          if (this.usuario) {
            const updated = { ...this.usuario, reverso: '' };
            localStorage.setItem('usuario', JSON.stringify(updated));
            (this.auth as any)._usuario.set(updated);
          }
        } else if (type === 'Tapete') {
          this.equippedTapeteName.set(null);
          if (this.usuario) {
            const updated = { ...this.usuario, tapete: '' };
            localStorage.setItem('usuario', JSON.stringify(updated));
            (this.auth as any)._usuario.set(updated);
          }
        }
      },
    });
  }

  // Imágenes: usa url de BD si existe, si no el asset local
  getSkinImageUrl(skin: Skin): string {
    return skin.url || `assets/skins/${skin.name}.png`;
  }

  onImgError(name: string) {
    this.imgFailed.update(s => new Set(s).add(name));
  }

  // Gradientes y iconos (mismos que la tienda)
  getSkinGradient(name: string): string {
    const gradients: Record<string, string> = {
      'Cubo':       'linear-gradient(135deg, #00e5ff 0%, #0052d4 100%)',
      'Cyberpunk':  'linear-gradient(135deg, #f72585 0%, #7209b7 50%, #3a0ca3 100%)',
      'Fenix':      'linear-gradient(135deg, #ff6b35 0%, #f7c948 50%, #ff3d00 100%)',
      'Dragon':     'linear-gradient(135deg, #2d1b69 0%, #b91c1c 50%, #fbbf24 100%)',
      'Onda':       'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)',
      'Geométrico': 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
      'Hexágono':   'linear-gradient(135deg, #059669 0%, #34d399 100%)',
      'Círculo':    'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
      'Brújula':    'linear-gradient(135deg, #1e3a5f 0%, #38bdf8 100%)',
      'Degradado':  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'Cyborg':     'linear-gradient(135deg, #374151 0%, #00e5ff 50%, #374151 100%)',
      'Cubito':     'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
      'Flor':       'linear-gradient(135deg, #ec4899 0%, #f472b6 50%, #fbbf24 100%)',
      'Saturno':    'linear-gradient(135deg, #1e1b4b 0%, #a855f7 50%, #fbbf24 100%)',
      'Cristales':  'linear-gradient(135deg, #06b6d4 0%, #a855f7 50%, #f0abfc 100%)',
      'Lava':       'linear-gradient(135deg, #dc2626 0%, #f97316 50%, #fbbf24 100%)',
      'Elementos':  'linear-gradient(135deg, #22c55e 0%, #3b82f6 50%, #ef4444 100%)',
      'Galaxia':    'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      'Chip':       'linear-gradient(135deg, #064e3b 0%, #00e5ff 100%)',
      'Benja':      'linear-gradient(135deg, #7c3aed 0%, #f43f5e 100%)',
      'Azul':       'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #38bdf8 100%)',
    };
    return gradients[name] || 'linear-gradient(135deg, #1e293b 0%, #334155 100%)';
  }

  getSkinIcon(name: string): string {
    const icons: Record<string, string> = {
      'Cubo': '🎲', 'Cyberpunk': '🤖', 'Fenix': '🔥', 'Dragon': '🐉',
      'Onda': '🌊', 'Geométrico': '🔷', 'Hexágono': '⬡', 'Círculo': '⚪',
      'Brújula': '🧭', 'Degradado': '🎨', 'Cyborg': '⚡', 'Cubito': '💚',
      'Flor': '🌸', 'Saturno': '🪐', 'Cristales': '💎', 'Lava': '🌋',
      'Elementos': '🜛', 'Galaxia': '🌌', 'Chip': '🔌', 'Benja': '👾',
      'Azul': '🟦',
    };
    return icons[name] || '🃏';
  }
}
