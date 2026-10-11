import { useEffect } from 'react';
import { useAuth } from '../auth/useAuth';
import { t } from '../i18n';

/** Sets the browser tab title: "Page · TENANT · CamTech console". */
export function useDocumentTitle(title: string | null | undefined): void {
  const { tenant } = useAuth();
  const code = tenant?.code;
  useEffect(() => {
    if (!title) return;
    document.title = [title, code, t('app.name')].filter(Boolean).join(' · ');
  }, [title, code]);
}
