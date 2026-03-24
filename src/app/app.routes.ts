import { Routes } from '@angular/router';
import { WelcomeComponent } from './components/auth/welcome/welcome';
import { LoginComponent } from './components/auth/login/login';
import { RegisterComponent } from './components/auth/register/register';
import { ForgotPasswordComponent } from './components/auth/forgot-password/forgot-password';
import { ChangePasswordComponent } from './components/auth/change-password/change-password';
import { Lobby } from './components/lobby/lobby';
import { Tablero } from './components/tablero/tablero';
import { Shop } from './components/shop/shop';
import { Inventory } from './components/inventory/inventory';

export const routes: Routes = [
  { path: '',                component: WelcomeComponent,        data: { animation: 'welcome' } },
  { path: 'login',          component: LoginComponent,           data: { animation: 'login' } },
  { path: 'register',       component: RegisterComponent,        data: { animation: 'register' } },
  { path: 'forgot-password', component: ForgotPasswordComponent, data: { animation: 'forgot' } },
  { path: 'change-password', component: ChangePasswordComponent, data: { animation: 'change' } },
  { path: 'lobby',          component: Lobby,                    data: { animation: 'lobby' } },
  { path: 'shop',           component: Shop,                     data: { animation: 'shop' } },
  { path: 'inventory',      component: Inventory,                data: { animation: 'inventory' } },
  { path: 'tablero',        component: Tablero,                  data: { animation: 'tablero' } },
  { path: '**',             redirectTo: '' },
];
