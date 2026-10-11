import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AdminOnly, RequireAuth } from './auth/RequireAuth';
import { ChangePasswordPage } from './auth/ChangePasswordPage';
import { LoginPage } from './auth/LoginPage';
import { ForbiddenPage, NotFoundPage } from './features/misc/StatusPages';
import { AppLayout } from './layout/AppLayout';

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const SessionsPage = lazy(() => import('./features/sessions/SessionsPage'));
const SessionDetailPage = lazy(() => import('./features/sessions/SessionDetailPage'));
const ReviewQueuePage = lazy(() => import('./features/reviews/ReviewQueuePage'));
const ReviewCasePage = lazy(() => import('./features/reviews/ReviewCasePage'));
const PeoplePage = lazy(() => import('./features/people/PeoplePage'));
const PersonDetailPage = lazy(() => import('./features/people/PersonDetailPage'));
const DocumentsPage = lazy(() => import('./features/documents/DocumentsPage'));
const DocumentDetailPage = lazy(() => import('./features/documents/DocumentDetailPage'));
const ScansPage = lazy(() => import('./features/documents/ScansPage'));
const ScanDetailPage = lazy(() => import('./features/documents/ScanDetailPage'));
const TenantPage = lazy(() => import('./features/config/TenantPage'));
const ClientAppsPage = lazy(() => import('./features/config/ClientAppsPage'));
const SettingsPage = lazy(() => import('./features/config/SettingsPage'));
const FlowsPage = lazy(() => import('./features/config/FlowsPage'));
const MessagesPage = lazy(() => import('./features/config/MessagesPage'));
const WebhooksPage = lazy(() => import('./features/config/WebhooksPage'));
const RetentionPage = lazy(() => import('./features/config/RetentionPage'));
const AuditPage = lazy(() => import('./features/admin/AuditPage'));
const UsersPage = lazy(() => import('./features/admin/UsersPage'));

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="verifications" element={<SessionsPage />} />
        <Route path="verifications/:publicId" element={<SessionDetailPage />} />
        <Route path="reviews" element={<ReviewQueuePage />} />
        <Route path="reviews/:id" element={<ReviewCasePage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/:id" element={<PersonDetailPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="scans" element={<ScansPage />} />
        <Route path="scans/:id" element={<ScanDetailPage />} />
        <Route path="config/tenant" element={<TenantPage />} />
        <Route path="config/client-apps" element={<ClientAppsPage />} />
        <Route path="config/client-apps/:id" element={<ClientAppsPage />} />
        <Route path="config/settings" element={<SettingsPage />} />
        <Route path="config/flows" element={<FlowsPage />} />
        <Route path="config/messages" element={<MessagesPage />} />
        <Route path="config/webhooks" element={<WebhooksPage />} />
        <Route path="config/retention" element={<RetentionPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route
          path="users"
          element={
            <AdminOnly>
              <UsersPage />
            </AdminOnly>
          }
        />
        <Route path="forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
