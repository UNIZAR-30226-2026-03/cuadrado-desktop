import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-tutorial',
  standalone: true,
  imports: [],
  templateUrl: './tutorial.html',
  styleUrl: './tutorial.scss',
})
export class Tutorial {
  constructor(private router: Router) {}

  goBack() {
    this.router.navigate(['/rooms']);
  }
}
