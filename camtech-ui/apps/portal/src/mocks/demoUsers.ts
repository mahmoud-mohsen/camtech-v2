// Sign-in accounts of the mock backend (mock mode only). Shown as a hint on the login page.
import type { TenantUserRole } from '@camtech/api-client';

export const DEMO_PASSWORD = 'Demo123456';

export interface DemoUser {
  username: string;
  displayName: string;
  email: string;
  role: TenantUserRole;
  tenantCode: string;
  mustChangePassword?: boolean;
}

export const DEMO_USERS: DemoUser[] = [
  { username: 'owner', displayName: 'Mariam Al Hashimi', email: 'mariam@noqodi.example', role: 'OWNER', tenantCode: 'NOQODI' },
  { username: 'developer', displayName: 'Karim Haddad', email: 'karim@noqodi.example', role: 'DEVELOPER', tenantCode: 'NOQODI' },
  { username: 'reviewer', displayName: 'Sara Nasser', email: 'sara@noqodi.example', role: 'REVIEWER', tenantCode: 'NOQODI' },
  { username: 'viewer', displayName: 'Omar Saeed', email: 'omar@noqodi.example', role: 'VIEWER', tenantCode: 'NOQODI' },
  { username: 'newbie', displayName: 'Layla Farouk', email: 'layla@noqodi.example', role: 'DEVELOPER', tenantCode: 'NOQODI', mustChangePassword: true },
  { username: 'demo.owner', displayName: 'Demo Owner', email: 'owner@demo.example', role: 'OWNER', tenantCode: 'DEMO' },
];
