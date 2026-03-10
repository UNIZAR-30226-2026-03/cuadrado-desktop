import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tablero } from './tablero';

describe('Tablero', () => {
  let component: Tablero;
  let fixture: ComponentFixture<Tablero>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Tablero],
    }).compileComponents();

    fixture = TestBed.createComponent(Tablero);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
