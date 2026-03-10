import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  trigger, transition, style, animate, sequence
} from '@angular/animations';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './welcome.html',
  styleUrl: './welcome.scss',
  host: { '[@pageFade]': '' },
  animations: [
    trigger('pageFade', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('400ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [
        animate('250ms ease-in', style({ opacity: 0 })),
      ]),
    ]),
  ],
})
export class WelcomeComponent {}
