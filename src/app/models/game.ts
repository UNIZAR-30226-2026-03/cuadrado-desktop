export interface Usuario {
    id: number;
    nombre: string;
    monedas: number;
    exp: number;
    partidasJugadas: number;
    partidasGanadas: number;
    ranking: number;
    avatar: string;
    reverso: string;
    tapete: string;
}

export interface Inventario {
    avatares: string[];
    reversos: string[];
    tapetes: string[];
}

export interface EstadoAutenticacion {
    usuario: Usuario | null;
    estaAutenticado: boolean;
}

export interface Carta {
    palo: 'hearts' | 'diamonds' | 'clubs' | 'spades';
    valor: string;            // "A","2"…"K"
    estaVisible: boolean;
}

export interface Jugador {
    id: number;                 // [1..8]
    idUsuario: number;         // ID del usuario que controla este jugador
    cartas: Carta[];            // Siempre 4 cartas en Cubo
    estaSilenciado: boolean;     // Si tiene el audio silenciado
    estaEnsordecido: boolean; // Si no puede escuchar
}

export interface SalaConfig {
    nombre: string;
    maxJugadores: number;     // 2-8
    barajas: 1 | 2;                // 1 o 2 barajas
    reglasEspeciales: boolean[]; // [true, false, false, false...] => solo el as es especial
    esPrivada: boolean;
    codigo?: string;                // Solo existe si isPrivate es true
}

export interface Sala {
    id: string;
    config: SalaConfig;
    jugadores: Jugador[];
    estado: 'waiting' | 'playing' | 'finished';
}

export interface EstadoPartida {
    idSala: string;
    turnoActual: number;         // ID del jugador que tiene el turno
    cartasRestantes: Carta[];                // Cartas restantes en el mazo
    ultimoDescarte: Carta | null; // Carta visible en la pila de descarte
    tiempoRestante: number;             // Segundos restantes del turno
    fase: 'waiting' | 'dealing' | 'playing' | 'finished';
    jugadorCubo: number;         // ID del jugador que ha hecho Cubo, si hay alguno (si no 0)
}

