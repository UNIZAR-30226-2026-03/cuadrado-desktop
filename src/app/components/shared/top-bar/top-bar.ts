import { Component, EventEmitter, Output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AuthService } from '../../../services/auth';

@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [DecimalPipe],
  templateUrl: './top-bar.html',
  styleUrl: './top-bar.scss',
})
export class TopBar {
  @Output() settings = new EventEmitter<void>();

  constructor(protected auth: AuthService) {}

  get cubitos(): number {
    return this.auth.usuario()?.monedas ?? 0;
  }

  onSettingsClick(): void {
    this.settings.emit();
  }
}
