import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom';
import { ChangePasswordPage } from './auth/ChangePasswordPage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './layout/AppLayout';
import { RouteError } from './layout/RouteError';

type Page = LazyExoticComponent<ComponentType>;

const OverviewPage = lazy(() => import('./features/overview/OverviewPage'));
const VerificationsPage = lazy(() => import('./features/verifications/VerificationsPage'));
const VerificationDetailPage = lazy(() => import('./features/verifications/VerificationDetailPage'));
const ScansPage = lazy(() => import('./features/scans/ScansPage'));
const ScanDetailPage = lazy(() => import('./features/scans/ScanDetailPage'));
const AppsPage = lazy(() => import('./features/apps/AppsPage'));
const WebhooksPage = lazy(() => import('./features/webhooks/WebhooksPage'));
const FlowsPage = lazy(() => import('./features/flows/FlowsPage'));
const BrandingPage = lazy(() => import('./features/branding/BrandingPage'));
const PlaygroundPage = lazy(() => import('./features/playground/PlaygroundPage'));
const GuidePage = lazy(() => import('./features/guide/IntegrationGuidePage'));
const AuditPage = lazy(() => import('./features/audit/AuditPage'));
const DocumentsPage = lazy(() => import('./features/documents/DocumentsPage'));
const DocumentDetailPage = lazy(() => import('./features/documents/DocumentDetailPage'));
const PeoplePage = lazy(() => import('./features/people/PeoplePage'));
const PersonDetailPage = lazy(() => import('./features/people/PersonDetailPage'));
const ReviewsPage = lazy(() => import('./features/reviews/ReviewsPage'));
const ReviewCasePage = lazy(() => import('./features/reviews/ReviewCasePage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const NotFoundPage = lazy(() => import('./features/misc/NotFoundPage'));

/** Old addresses (bookmarks, links in e-mails) that moved. */
function redirect(path: string, to: string): RouteObject {
  return { path, element: <Navigate to={to} replace /> };
}

/** Every page gets its own error boundary, so one broken page doesn't take the console down. */
function page(path: string | undefined, Component: Page): RouteObject {
  const route: RouteObject = path === undefined ? { index: true } : { path };
  return { ...route, element: <Component />, errorElement: <RouteError /> };
}

const router = createBrowserRouter([
  // A `?tenant=` query (old back-office links) is simply ignored: the tenant comes from the signed-in user.
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/change-password', element: <ChangePasswordPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      page(undefined, OverviewPage),
      page('verifications', VerificationsPage),
      page('verifications/:publicId', VerificationDetailPage),
      page('scans', ScansPage),
      redirect('scans/settings', '/settings/ocr'),
      page('scans/:id', ScanDetailPage),
      page('reviews', ReviewsPage),
      page('reviews/:id', ReviewCasePage),
      page('documents', DocumentsPage),
      page('documents/:id', DocumentDetailPage),
      page('people', PeoplePage),
      page('people/:id', PersonDetailPage),
      page('settings', SettingsPage),
      page('settings/:section', SettingsPage),
      page('apps', AppsPage),
      page('apps/:id', AppsPage),
      page('webhooks', WebhooksPage),
      page('flows', FlowsPage),
      page('branding', BrandingPage),
      page('playground', PlaygroundPage),
      page('guide', GuidePage),
      page('audit', AuditPage),
      redirect('reason-codes', '/guide?tab=reasons'),
      redirect('users', '/settings/team'),
      page('*', NotFoundPage),
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
