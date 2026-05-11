import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsFabComponent } from '../../shared/settings-fab/settings-fab';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [RouterLink, SettingsFabComponent],
  templateUrl: './welcome.html',
  styleUrl: './welcome.scss',
})
export class WelcomeComponent {}
