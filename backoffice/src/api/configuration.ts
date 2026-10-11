import { http } from './client';
import type {
  AdminUser, Capabilities, ClientApp, ClientAppCreate, ClientAppUpdate, ConfigKey, ConfigParam, ConfigParamCreate,
  AdminFlowLiveness, Credential, DocumentType, Entitlement, EntitlementUpdate, Flow, Issuer, LivenessPolicyUpdate, ReasonCode, RetentionPolicy, Role, Tenant, TenantCreate, TenantCreated, TenantSummary,
  TenantUserCreate, TenantUserUpdate, TenantUserView,
  Page, Webhook, WebhookDelivery,
} from './types';

export const tenantApi = {
  get: () => http.get<Tenant>('/v2/admin/tenant'),
  entitlements: () => http.get<Entitlement[]>('/v2/admin/entitlements'),
  updateEntitlement: (id: number, body: EntitlementUpdate) => http.put<Entitlement>(`/v2/admin/entitlements/${id}`, body),
  list: () => http.get<TenantSummary[]>('/v2/admin/tenants'),
  /** With `owner`, also creates the tenant's first portal OWNER and returns its password once. */
  create: (body: TenantCreate) => http.post<TenantCreated>('/v2/admin/tenants', body),
  update: (id: number, body: { name?: string; status?: TenantSummary['status'] }) => http.put<TenantSummary>(`/v2/admin/tenants/${id}`, body),
  /** The plan of one tenant (the default tenant's is also at /v2/admin/entitlements). */
  tenantEntitlements: (tenantId: number) => http.get<Entitlement[]>(`/v2/admin/tenants/${tenantId}/entitlements`),
  updateTenantEntitlement: (tenantId: number, id: number, body: EntitlementUpdate) =>
    http.put<Entitlement>(`/v2/admin/tenants/${tenantId}/entitlements/${id}`, body),
  /** One tenant's client apps, read-only (to scope a setting). */
  clientApps: (tenantId: number) => http.get<ClientApp[]>(`/v2/admin/tenants/${tenantId}/client-apps`),
};

/** Tenant portal users, managed by CamTech (errors: 409 USERNAME_TAKEN, 409 LAST_OWNER, 400 WEAK_PASSWORD). */
export const tenantUsersApi = {
  list: (tenantId: number) => http.get<TenantUserView[]>(`/v2/admin/tenants/${tenantId}/users`),
  /** Blank password = the server generates one. The password is returned only here. */
  create: (tenantId: number, body: TenantUserCreate) =>
    http.post<{ user: TenantUserView; password: string }>(`/v2/admin/tenants/${tenantId}/users`, body),
  update: (tenantId: number, userId: number, body: TenantUserUpdate) =>
    http.put<TenantUserView>(`/v2/admin/tenants/${tenantId}/users/${userId}`, body),
  resetPassword: (tenantId: number, userId: number, password?: string | null) =>
    http.post<{ password: string }>(`/v2/admin/tenants/${tenantId}/users/${userId}/reset-password`, { password: password || null }),
};

export const livenessApi = {
  /** Both liveness flows of a tenant: policy, the tenant's current settings, and whether it customised them. */
  list: (tenantId: number) => http.get<AdminFlowLiveness[]>(`/v2/admin/tenants/${tenantId}/liveness-policies`),
  get: (tenantId: number, flowCode: string) =>
    http.get<AdminFlowLiveness>(`/v2/admin/tenants/${tenantId}/flows/${encodeURIComponent(flowCode)}/liveness-policy`),
  /** 409 TENANT_SETTINGS_CONFLICT when the tenant's saved settings would no longer fit (send resetTenant: true to reset them). */
  update: (tenantId: number, flowCode: string, body: LivenessPolicyUpdate) =>
    http.put<AdminFlowLiveness>(`/v2/admin/tenants/${tenantId}/flows/${encodeURIComponent(flowCode)}/liveness-policy`, body),
};

export const clientAppsApi = {
  list: () => http.get<ClientApp[]>('/v2/admin/client-apps'),
  create: (body: ClientAppCreate) => http.post<ClientApp>('/v2/admin/client-apps', body),
  update: (id: number, body: ClientAppUpdate) => http.put<ClientApp>(`/v2/admin/client-apps/${id}`, body),
  setPermissions: (id: number, perms: { featureCode: string; allowed: boolean }[]) =>
    http.put<ClientApp>(`/v2/admin/client-apps/${id}/permissions`, perms),
  credentials: (id: number) => http.get<Credential[]>(`/v2/admin/client-apps/${id}/credentials`),
  createCredential: (id: number, expiresAt: string | null) =>
    http.post<{ credential: Credential; secret: string }>(`/v2/admin/client-apps/${id}/credentials`, { expiresAt }),
  revokeCredential: (credentialId: number) => http.post<Credential>(`/v2/admin/credentials/${credentialId}/revoke`),
  capabilities: (id: number) => http.get<Capabilities>(`/v2/admin/client-apps/${id}/capabilities`),
};

export const settingsApi = {
  keys: () => http.get<ConfigKey[]>('/v2/admin/config-keys'),
  params: () => http.get<ConfigParam[]>('/v2/admin/config-params'),
  create: (body: ConfigParamCreate) => http.post<ConfigParam>('/v2/admin/config-params', body),
  update: (id: number, paramValue: string) => http.put<ConfigParam>(`/v2/admin/config-params/${id}`, { paramValue }),
  remove: (id: number) => http.del(`/v2/admin/config-params/${id}`),
};

/** Settings (config params) of one tenant. */
export const tenantSettingsApi = (tenantId: number) => ({
  params: () => http.get<ConfigParam[]>(`/v2/admin/tenants/${tenantId}/config-params`),
  create: (body: ConfigParamCreate) => http.post<ConfigParam>(`/v2/admin/tenants/${tenantId}/config-params`, body),
  update: (id: number, paramValue: string) => http.put<ConfigParam>(`/v2/admin/tenants/${tenantId}/config-params/${id}`, { paramValue }),
  remove: (id: number) => http.del(`/v2/admin/tenants/${tenantId}/config-params/${id}`),
});

export const catalogApi = {
  flows: () => http.get<Flow[]>('/v2/admin/flows'),
  updateFlowStep: (code: string, stepId: number, body: { maxAttempts: number }) =>
    http.put<Flow>(`/v2/admin/flows/${encodeURIComponent(code)}/steps/${stepId}`, body),
  documentTypes: () => http.get<DocumentType[]>('/v2/admin/document-types'),
  issuers: () => http.get<Issuer[]>('/v2/admin/issuers'),
  reasonCodes: () => http.get<ReasonCode[]>('/v2/admin/reason-codes'),
  updateReasonCode: (code: string, body: { messageEn: string; messageAr: string | null }) =>
    http.put<ReasonCode>(`/v2/admin/reason-codes/${encodeURIComponent(code)}`, body),
};

export const retentionApi = {
  list: () => http.get<RetentionPolicy[]>('/v2/admin/retention-policies'),
  update: (id: number, retentionDays: number) =>
    http.put<RetentionPolicy>(`/v2/admin/retention-policies/${id}`, { retentionDays }),
};

export const webhooksApi = {
  list: () => http.get<Webhook[]>('/v2/admin/webhooks'),
  create: (url: string, events: string[]) =>
    http.post<{ webhook: Webhook; secret: string }>('/v2/admin/webhooks', { url, events }),
  update: (id: number, body: { url: string; events: string[]; status: Webhook['status'] }) =>
    http.put<Webhook>(`/v2/admin/webhooks/${id}`, body),
  remove: (id: number) => http.del(`/v2/admin/webhooks/${id}`),
  rotateSecret: (id: number) => http.post<{ webhook: Webhook; secret: string }>(`/v2/admin/webhooks/${id}/rotate-secret`),
  test: (id: number) => http.post<WebhookDelivery>(`/v2/admin/webhooks/${id}/test`),
  deliveries: (id: number, page: number, size: number) =>
    http.get<Page<WebhookDelivery>>(`/v2/admin/webhooks/${id}/deliveries`, { page, size }),
  retry: (deliveryId: number) => http.post<WebhookDelivery>(`/v2/admin/webhook-deliveries/${deliveryId}/retry`),
};

export const usersApi = {
  list: () => http.get<AdminUser[]>('/v2/admin/users'),
  create: (body: { username: string; displayName: string; email: string | null; role: Role }) =>
    http.post<{ user: AdminUser; temporaryPassword: string }>('/v2/admin/users', body),
  update: (id: number, body: { displayName: string; email: string | null; role: Role; status: AdminUser['status'] }) =>
    http.put<AdminUser>(`/v2/admin/users/${id}`, body),
  resetPassword: (id: number) => http.post<{ temporaryPassword: string }>(`/v2/admin/users/${id}/reset-password`),
};
