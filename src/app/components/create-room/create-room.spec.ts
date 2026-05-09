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

  it('sets dificultadBots signal when a button is clicked', async () => {
    component.fillWithBots.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    // Get the difficulty selector row (first .turn-time-row in the DOM)
    const rows = fixture.debugElement.queryAll(By.css('.turn-time-row'));
    const diffRow = rows[0]; // difficulty row appears first in template
    const buttons = diffRow.queryAll(By.css('button'));

    // Click "Fácil" (index 0) via Angular's event system
    buttons[0].triggerEventHandler('click', null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.dificultadBots()).toBe('facil');

    // Click "Difícil" (index 2)
    buttons[2].triggerEventHandler('click', null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.dificultadBots()).toBe('dificil');
  });

});
