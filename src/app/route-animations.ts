import {
  trigger, transition, style, animate, query, group,
} from '@angular/animations';

export const routeAnimations = trigger('routeAnimations', [
  transition('* <=> *', [
    // Posicionar ambas vistas superpuestas durante la transición
    query(':enter, :leave', [
      style({
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
      }),
    ], { optional: true }),

    // Crossfade: fade-out saliente + fade-in entrante simultáneamente
    group([
      query(':leave', [
        style({ opacity: 1 }),
        animate('280ms ease-in', style({ opacity: 0 })),
      ], { optional: true }),

      query(':enter', [
        style({ opacity: 0 }),
        animate('280ms 100ms ease-out', style({ opacity: 1 })),
      ], { optional: true }),
    ]),
  ]),
]);
