import { Component, signal } from '@angular/core';
import { SettingsPopupComponent } from '../settings-popup/settings-popup';

@Component({
  selector: 'app-settings-fab',
  standalone: true,
  imports: [SettingsPopupComponent],
  templateUrl: './settings-fab.html',
  styleUrl: './settings-fab.scss',
})
export class SettingsFabComponent {
  readonly showPopup = signal(false);

  open(): void { this.showPopup.set(true); }
  close(): void { this.showPopup.set(false); }
}
