import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { routeAnimations } from './route-animations';
import { BackgroundMusicService } from './services/background-music';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  animations: [routeAnimations],
})
export class App implements OnInit {
  protected readonly title = signal('cuadrado-app');

  constructor(private backgroundMusic: BackgroundMusicService) {}

  ngOnInit(): void {
    this.backgroundMusic.init();
  }

  getRouteAnimationData(outlet: RouterOutlet) {
    return outlet?.activatedRouteData?.['animation'];
  }
}