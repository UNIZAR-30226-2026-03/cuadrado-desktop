import { Component, OnInit, output } from '@angular/core';
import { VoiceChatService } from '../../../services/voice-chat';

@Component({
  selector: 'app-settings-popup',
  standalone: true,
  imports: [],
  templateUrl: './settings-popup.html',
  styleUrl: './settings-popup.scss',
})
export class SettingsPopupComponent implements OnInit {
  readonly closed = output<void>();

  constructor(protected voiceChat: VoiceChatService) {}

  ngOnInit(): void {
    this.voiceChat.requestPermissionAndLoadDevices();
  }

  close(): void { this.closed.emit(); }
}
