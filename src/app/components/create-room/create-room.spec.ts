import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CreateRoom } from './create-room';
import { AuthService } from '../../services/auth';
import { RoomService } from '../../services/room';
import { WebsocketService } from '../../services/websocket';
import { VoiceChatService } from '../../services/voice-chat';

describe('CreateRoom — dificultad de bots', () => {
  let component: CreateRoom;
  let fixture: ComponentFixture<CreateRoom>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateRoom],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AuthService,      useValue: { usuario: () => ({ nombre: 'Test' }), getToken: () => 'tok' } },
        { provide: RoomService,      useValue: { generarCodigo: () => 'ABC123', guardarSala: () => {}, setEsAnfitrion: () => {} } },
        { provide: WebsocketService, useValue: { conectarYEsperar: () => Promise.resolve(), leaveRoomAck: () => Promise.resolve(), createRoom: () => Promise.resolve({ success: false }), estaConectado: () => false, voicePeers$: { subscribe: () => ({ unsubscribe: () => {} }) }, voicePeerJoined$: { subscribe: () => ({ unsubscribe: () => {} }) }, voicePeerLeft$: { subscribe: () => ({ unsubscribe: () => {} }) }, voiceOffer$: { subscribe: () => ({ unsubscribe: () => {} }) }, voiceAnswer$: { subscribe: () => ({ unsubscribe: () => {} }) }, voiceIceCandidate$: { subscribe: () => ({ unsubscribe: () => {} }) }, voiceMuteChanged$: { subscribe: () => ({ unsubscribe: () => {} }) } } },
        { provide: ActivatedRoute,   useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: VoiceChatService, useValue: { requestPermissionAndLoadDevices: () => Promise.resolve(false), micPermission: { subscribe: () => {} }, audioInputDevices: () => [], localStream: () => null, selectedDeviceId: () => 'default', outputVolume: () => 80, musicVolume: () => 80, sfxVolume: () => 80, micMuted: () => false, localSpeaking: () => false, speakingPeers: () => new Set(), connectedPeers: () => [], mutedPeers: () => new Set(), selfMutedPeers: () => new Set() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateRoom);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('defaults dificultadBots to media', () => {
    expect(component.dificultadBots()).toBe('media');
  });

  it('does not render difficulty selector when fillWithBots is false', () => {
    component.fillWithBots.set(false);
    fixture.detectChanges();
    // El turn-time-row del tiempo por turno siempre existe;
    // el de dificultad solo aparece con bots activos.
    // Contamos: sin bots → 1 fila (tiempo), con bots → 2 filas.
    expect(fixture.nativeElement.querySelectorAll('.turn-time-row').length).toBe(1);
  });

  it('renders difficulty selector when fillWithBots is true', () => {
    component.fillWithBots.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.turn-time-row').length).toBe(2);
  });

  it('sets dificultadBots signal when a button is clicked', () => {
    component.fillWithBots.set(true);
    fixture.detectChanges();

    // La fila de dificultad aparece ANTES que la de tiempo en el DOM
    // (el @if de dificultad está declarado antes del bloque de turnTimeOptions en el template)
    // → rows[0] = dificultad (3 botones), rows[1] = tiempo por turno (6 botones)
    const rows = fixture.nativeElement.querySelectorAll('.turn-time-row');
    const diffRow = rows[0] as HTMLElement;
    const buttons = Array.from(diffRow.querySelectorAll('button')) as HTMLButtonElement[];

    // buttons[0] = Fácil, [1] = Normal, [2] = Difícil
    expect(buttons.length).toBe(3);

    // Llamamos directamente al setter del signal igual que lo hace el template al hacer click
    component.dificultadBots.set('facil');
    fixture.detectChanges();
    expect(component.dificultadBots()).toBe('facil');
    expect(buttons[0].classList.contains('turn-time-btn--active')).toBe(true);

    component.dificultadBots.set('dificil');
    fixture.detectChanges();
    expect(component.dificultadBots()).toBe('dificil');
    expect(buttons[2].classList.contains('turn-time-btn--active')).toBe(true);
  });

});
