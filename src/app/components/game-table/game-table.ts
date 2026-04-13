import {
  Component, Input, OnInit, OnDestroy, signal, computed,
  ElementRef, ViewChild, AfterViewInit
} from '@angular/core';
import { NgStyle } from '@angular/common';

type IdlePhase = 'idle' | 'drawing' | 'peeking' | 'swapping' | 'discarding';
type PlayerPosition = 'north' | 'south' | 'east' | 'west';
interface TableCard { value: string; suit: string; }

const TURN_ORDER: PlayerPosition[] = ['north', 'east', 'south', 'west'];
const LOCAL_PLAYER: PlayerPosition = 'south';

const CARD_VALUES = ['3', '8', 'K', 'A', '5', '2', '10', 'J', 'Q', '9', '4', '6', '7'];
const CARD_SUITS = ['♠', '♥', '♦', '♣'];
const CARD_DECK: TableCard[] = CARD_SUITS.flatMap(suit =>
  CARD_VALUES.map(value => ({ value, suit })),
);

@Component({
  selector: 'app-game-table',
  standalone: true,
  imports: [NgStyle],
  templateUrl: './game-table.html',
  styleUrl: './game-table.scss',
})
export class GameTable implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('tableEl') tableEl!: ElementRef<HTMLElement>;
  @Input() reversoUrl: string | null = null;

  phase = signal<IdlePhase>('idle');
  drawnCard = signal<TableCard | null>(null);
  cardAtPlayer = signal(false);
  swapTarget = signal<number | null>(null);
  discardCard = signal<TableCard>({ value: '7', suit: '♠' });
  turnIndex = signal(0);

  surfaceWidth = signal(0);
  surfaceHeight = signal(0);
  tableScale = signal(1);
  drawOffsets = signal({ northX: -92, northY: -108, southX: 112, southY: 106, eastX: 180, westX: -180 });

  activePlayer = computed(() => TURN_ORDER[this.turnIndex() % TURN_ORDER.length]);
  isLocalTurn = computed(() => this.activePlayer() === LOCAL_PLAYER);
  drawnTargetClass = computed(() => `game-table__drawn--to-${this.activePlayer()}`);

  drawnClasses = computed(() => {
    const parts = ['game-table__drawn', this.drawnTargetClass()];
    if (this.drawnCard()) parts.push('game-table__drawn--visible');
    if (this.cardAtPlayer()) parts.push('game-table__drawn--at-player');
    if (this.phase() === 'peeking') {
      parts.push('game-table__drawn--peek');
      if (!this.isLocalTurn()) parts.push('game-table__drawn--peek-private');
    }
    if (this.phase() === 'discarding') parts.push('game-table__drawn--discard');
    return parts.join(' ');
  });

  drawnColorKey = computed(() => {
    const c = this.drawnCard();
    return c ? this.colorKey(c.suit) : '';
  });

  discardColorKey = computed(() => this.colorKey(this.discardCard().suit));

  positions: PlayerPosition[] = ['north', 'east', 'west', 'south'];
  cardIndices = [0, 1, 2, 3];

  private timers: ReturnType<typeof setTimeout>[] = [];
  private drawCount = 0;
  private deckCursor = 16;
  private playerHands: Record<PlayerPosition, TableCard[]> = this.buildInitialHands();
  private observer: ResizeObserver | null = null;

  ngOnInit(): void {
    this.startTurn();
  }

  ngAfterViewInit(): void {
    this.updateSize();
    this.observer = new ResizeObserver(() => this.updateSize());
    this.observer.observe(this.tableEl.nativeElement);
  }

  ngOnDestroy(): void {
    this.timers.forEach(t => clearTimeout(t));
    this.observer?.disconnect();
  }

  isActive(pos: PlayerPosition): boolean {
    return this.activePlayer() === pos;
  }

  handSwapIndex(pos: PlayerPosition): number | null {
    return this.phase() === 'swapping' && pos === this.activePlayer()
      ? this.swapTarget()
      : null;
  }

  surfaceStyle() {
    const w = this.surfaceWidth();
    const h = this.surfaceHeight();
    if (!w || !h) return {};
    const off = this.drawOffsets();
    return {
      width: w + 'px',
      height: h + 'px',
      '--table-scale': '' + this.tableScale(),
      '--drawn-offset-north-x': off.northX + 'px',
      '--drawn-offset-north-y': off.northY + 'px',
      '--drawn-offset-south-x': off.southX + 'px',
      '--drawn-offset-south-y': off.southY + 'px',
      '--drawn-offset-east-x': off.eastX + 'px',
      '--drawn-offset-west-x': off.westX + 'px',
    };
  }

  colorKey(suit: string): string {
    return suit === '♦' || suit === '♥' ? 'red' : 'black';
  }

  cardStyle(): Record<string, string> {
    if (!this.reversoUrl) return {};
    return {
      'background-image': `url(${this.reversoUrl})`,
      'background-size': 'cover',
      'background-position': 'center',
      'background-repeat': 'no-repeat',
    };
  }

  private buildInitialHands(): Record<PlayerPosition, TableCard[]> {
    let cursor = 0;
    const next = () => CARD_DECK[cursor++ % CARD_DECK.length];
    return {
      north: [next(), next(), next(), next()],
      east: [next(), next(), next(), next()],
      south: [next(), next(), next(), next()],
      west: [next(), next(), next(), next()],
    };
  }

  private takeNextDeckCard(): TableCard {
    return CARD_DECK[this.deckCursor++ % CARD_DECK.length];
  }

  private clearTimers(): void {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private startTurn(): void {
    this.phase.set('idle');
    this.swapTarget.set(null);
    this.drawnCard.set(null);
    this.cardAtPlayer.set(false);

    this.after(700, () => {
      this.phase.set('drawing');

      this.after(500, () => {
        const drawn = this.takeNextDeckCard();
        this.drawCount++;
        this.drawnCard.set(drawn);

        this.after(350, () => {
          this.cardAtPlayer.set(true);
          this.phase.set('peeking');

          this.after(1400, () => {
            const doSwap = this.drawCount % 3 !== 0;
            const active = this.activePlayer();

            if (doSwap) {
              const target = Math.floor(Math.random() * 4);
              this.swapTarget.set(target);
              this.phase.set('swapping');

              this.after(1000, () => {
                const hand = this.playerHands[active] ?? [];
                const replaced = hand[target] ?? drawn;
                this.playerHands[active] = hand.map((c, i) => i === target ? drawn : c);

                this.discardCard.set(replaced);
                this.drawnCard.set(null);
                this.cardAtPlayer.set(false);
                this.swapTarget.set(null);
                this.phase.set('idle');
                this.turnIndex.update(i => (i + 1) % TURN_ORDER.length);
                this.clearTimers();
                this.startTurn();
              });
            } else {
              this.phase.set('discarding');
              this.cardAtPlayer.set(false);

              this.after(800, () => {
                this.discardCard.set(drawn);
                this.drawnCard.set(null);
                this.swapTarget.set(null);
                this.phase.set('idle');
                this.turnIndex.update(i => (i + 1) % TURN_ORDER.length);
                this.clearTimers();
                this.startTurn();
              });
            }
          });
        });
      });
    });
  }

  private updateSize(): void {
    const el = this.tableEl?.nativeElement;
    if (!el) return;
    const aw = el.clientWidth;
    const ah = el.clientHeight;
    if (!aw || !ah) return;

    const margin = 0.90;
    const mw = aw * margin;
    const mh = ah * margin;
    const aratio = mw / Math.max(mh, 1);
    const dynRatio = Math.min(2.2, Math.max(5 / 3, aratio * 0.9));

    let w = mw;
    let h = w / dynRatio;
    if (h > mh) { h = mh; w = h * dynRatio; }

    const rw = Math.floor(w);
    const rh = Math.floor(h);
    const baseW = 900;
    const scale = Math.max(0.72, Math.min(rw / baseW, 1.4));

    // La pila de robo está a la izquierda del centro de la superficie:
    // su centro está a (gap/2 + pile_width/2) = (10 + 21)*scale = 31*scale píxeles
    // a la izquierda del centro de la superficie.
    // Para que la carta llegue simétricamente a cada mano lateral, compensamos ese offset.
    const pileCenterOffset = Math.round(31 * scale);
    const latBase = Math.round(rw * 0.26);

    this.surfaceWidth.set(rw);
    this.surfaceHeight.set(rh);
    this.tableScale.set(scale);
    this.drawOffsets.set({
      northX: Math.round(-rw * 0.14),
      northY: Math.round(-rh * 0.24),
      southX: Math.round(rw * 0.14),
      southY: Math.round(rh * 0.24),
      eastX: latBase + pileCenterOffset,
      westX: -(latBase - pileCenterOffset),
    });
  }
}
