export interface Card {
  id: string;
  suit: string;
  value: string;
}

export interface GameState {
  gameId: string;
  players: string[];
  currentTurn: string;
  cardsInHand: Card[];
}