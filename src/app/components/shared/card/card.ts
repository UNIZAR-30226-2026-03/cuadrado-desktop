import { Component, Input } from '@angular/core';
import { Carta } from '../../../models/game';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './card.html',
  styleUrl: './card.scss' // Cambia a .scss o .css según lo que te haya generado
})
export class CardComponent {
  // @Input permite que el Tablero le "inyecte" los datos a esta carta desde el HTML
  @Input({ required: true }) carta!: Carta;
}