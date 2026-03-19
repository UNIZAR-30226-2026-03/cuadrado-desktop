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
  { path: '',                component: WelcomeComponent },
  { path: 'login',          component: LoginComponent },
  { path: 'register',       component: RegisterComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  { path: 'change-password', component: ChangePasswordComponent },
  { path: 'lobby',          component: Lobby },
  { path: 'shop',           component: Shop },
  { path: 'inventory',      component: Inventory },
  { path: 'tablero',        component: Tablero },
  { path: '**',             redirectTo: '' },
];
