import { Component, OnInit, signal, computed, ElementRef, ViewChild } from '@angular/core';
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
  type: 'Carta' | 'Tapete' | 'Avatar';
  price: number;
  url: string;
}

@Component({
  selector: 'app-shop',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './shop.html',
  styleUrl: './shop.scss',
  animations: [
    trigger('gridStagger', [
      transition(':enter', [
        query('.skin-card', [
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
export class Shop implements OnInit {
  // Estado
  imgFailed = signal<Set<string>>(new Set());
  allSkins = signal<Skin[]>([]);
  ownedSkinNames = signal<Set<string>>(new Set());
  equippedSkinId = signal<string | null>(null);
  equippedTapeteId = signal<string | null>(null);
  sortBy = signal<'price-asc' | 'price-desc' | 'name'>('price-asc');
  loading = signal(true);

  // Modal
  modalSkin = signal<Skin | null>(null);
  modalType = signal<'confirm' | 'insufficient' | 'success' | null>(null);
  purchasing = signal(false);

  @ViewChild('shopContainer') shopContainer!: ElementRef<HTMLElement>;

  // Computed: skins ordenadas por tipo
  private filteredAndSorted = computed(() => {
    const sort = this.sortBy();
    const sorted = [...this.allSkins()];
    if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
    else if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  });

  reverseSkins = computed(() => this.filteredAndSorted().filter(s => s.type === 'Carta'));
  tapeteSkins = computed(() => this.filteredAndSorted().filter(s => s.type === 'Tapete'));
  avatarSkins = computed(() => this.filteredAndSorted().filter(s => s.type === 'Avatar'));

  constructor(
    protected auth: AuthService,
    private router: Router,
    private http: HttpClient,
  ) {}

  get usuario() { return this.auth.usuario(); }

  ngOnInit() {
    this.loadData();
  }

  private normalizeSkinType(type: string | null | undefined): Skin['type'] | null {
    const normalized = (type ?? '').trim().toLowerCase();
    if (normalized === 'carta' || normalized === 'card' || normalized === 'reverso') return 'Carta';
    if (normalized === 'tapete' || normalized === 'mat') return 'Tapete';
    if (normalized === 'avatar') return 'Avatar';
    return null;
  }

  private normalizeSkin(raw: Partial<Skin> | null | undefined): Skin | null {
    if (!raw || typeof raw !== 'object') return null;

    const price = Number(raw.price);
    const name = (raw.name ?? '').trim();
    const type = this.normalizeSkinType(raw.type);
    if (!name || !type) return null;

    return {
      id: (raw.id ?? '').trim() || name,
      name,
      type,
      price: Number.isFinite(price) ? price : 0,
      url: (raw.url ?? '').trim(),
    };
  }

  private normalizeSkins(rawSkins: unknown): Skin[] {
    if (!Array.isArray(rawSkins)) return [];
    return rawSkins
      .map(raw => this.normalizeSkin(raw as Partial<Skin>))
      .filter((skin): skin is Skin => !!skin);
  }

  private getSkinIdentifier(skin: Skin): string {
    return skin.id || skin.name;
  }

  private loadData() {
    this.loading.set(true);
    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };

    // Cargar skins de la tienda
    this.http.get<Skin[]>(`${environment.apiUrl}/skins/store`).subscribe({
      next: (skins) => {
        this.allSkins.set(this.normalizeSkins(skins));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    // Cargar inventario del usuario
    this.http.get<Skin[]>(`${environment.apiUrl}/skins/inventory`, { headers }).subscribe({
      next: (owned) => {
        const normalizedOwned = this.normalizeSkins(owned);
        this.ownedSkinNames.set(new Set(normalizedOwned.map(s => s.name)));
        if (this.usuario) {
          this.equippedSkinId.set(this.usuario.reverso || null);
          this.equippedTapeteId.set(this.usuario.tapete || null);
        }
      },
    });
  }

  // Navegacion
  goBack() { this.router.navigate(['/lobby']); }
  goToInventory() { this.router.navigate(['/inventory']); }

  setSort(s: 'price-asc' | 'price-desc' | 'name') { this.sortBy.set(s); }

  isOwned(skin: Skin): boolean {
    return this.ownedSkinNames().has(skin.name);
  }

  isEquipped(skin: Skin): boolean {
    if (skin.type === 'Carta') return this.equippedSkinId() === skin.name;
    if (skin.type === 'Tapete') return this.equippedTapeteId() === skin.name;
    return false;
  }

  canAfford(skin: Skin): boolean {
    return (this.usuario?.monedas ?? 0) >= skin.price;
  }

  // Compra
  openBuyModal(skin: Skin) {
    this.modalSkin.set(skin);
    if (this.canAfford(skin)) {
      this.modalType.set('confirm');
    } else {
      this.modalType.set('insufficient');
    }
  }

  closeModal() {
    this.modalSkin.set(null);
    this.modalType.set(null);
  }

  confirmPurchase() {
    const skin = this.modalSkin();
    if (!skin) return;
    this.purchasing.set(true);

    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };
    this.http.post<any>(`${environment.apiUrl}/skins/buy/${this.getSkinIdentifier(skin)}`, {}, { headers }).subscribe({
      next: () => {
        this.purchasing.set(false);
        this.modalType.set('success');

        const owned = new Set(this.ownedSkinNames());
        owned.add(skin.name);
        this.ownedSkinNames.set(owned);

        if (this.usuario) {
          const updated = { ...this.usuario, monedas: this.usuario.monedas - skin.price };
          localStorage.setItem('usuario', JSON.stringify(updated));
          (this.auth as any)._usuario.set(updated);
        }

        setTimeout(() => this.closeModal(), 1500);
      },
      error: (err) => {
        this.purchasing.set(false);
        if (err.status === 400) this.modalType.set('insufficient');
        else if (err.status === 409) {
          const owned = new Set(this.ownedSkinNames());
          owned.add(skin.name);
          this.ownedSkinNames.set(owned);
          this.closeModal();
        }
      },
    });
  }

  selectFeatured(skin: Skin) {
    this.shopContainer.nativeElement.scrollTo({ top: 0, behavior: 'smooth' });
  }

  equipAndGoToInventory(skin: Skin) {
    const headers = { Authorization: `Bearer ${this.auth.getToken()}` };
    this.http.patch<any>(`${environment.apiUrl}/skins/equip/${this.getSkinIdentifier(skin)}`, {}, { headers }).subscribe({
      next: () => {
        if (this.usuario) {
          const field = skin.type === 'Tapete' ? 'tapete' : 'reverso';
          const updated = { ...this.usuario, [field]: skin.name };
          localStorage.setItem('usuario', JSON.stringify(updated));
          (this.auth as any)._usuario.set(updated);
        }
        this.router.navigate(['/inventory']);
      },
    });
  }

  // Imagenes
  getSkinImageUrl(skin: Skin): string {
    return skin.url || `assets/skins/${skin.name}.png`;
  }

  onImgError(name: string) {
    this.imgFailed.update(s => new Set(s).add(name));
  }

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
