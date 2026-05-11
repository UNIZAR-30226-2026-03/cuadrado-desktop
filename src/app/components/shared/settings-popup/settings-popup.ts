import { Component, output } from '@angular/core';
import { VoiceChatService } from '../../../services/voice-chat';
import { BackgroundMusicService } from '../../../services/background-music';

@Component({
  selector: 'app-settings-popup',
  standalone: true,
  imports: [],
  templateUrl: './settings-popup.html',
  styleUrl: './settings-popup.scss',
})
export class SettingsPopupComponent {
  readonly closed = output<void>();

  constructor(
    protected voiceChat: VoiceChatService,
    protected backgroundMusic: BackgroundMusicService,
  ) {}

  close(): void { this.closed.emit(); }
}
