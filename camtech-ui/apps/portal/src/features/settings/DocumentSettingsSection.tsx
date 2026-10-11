import { CamtechApiError, errorMessage, type DocumentSettings } from '@camtech/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Flex, Form, InputNumber, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DataState } from '../../components/DataState';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { SaveBar } from '../../components/SaveBar';
import { SectionTitle } from '../../components/ui';
import { t } from '../../i18n';
import { expiringBeforeFor } from '../../lib/expiry';
import { qk, useApiMutation, useDocumentSettings } from '../../lib/hooks';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';

function WarningForm({ s }: { s: DocumentSettings }) {
  const qc = useQueryClient();
  const { canBuild } = usePermissions();
  const [days, setDays] = useState<number | null>(s.expiryWarningDays);
  const [synced, setSynced] = useState(s.expiryWarningDays);
  const [error, setError] = useState<string | null>(null);
  if (s.expiryWarningDays !== synced) {
    setSynced(s.expiryWarningDays);
    setDays(s.expiryWarningDays);
  }
  const save = useApiMutation((v: number) => api.updateDocumentSettings(v), {
    success: t('documentSettings.saved'),
    onSuccess: (r) => qc.setQueryData(qk.documentSettings, r),
    invalidate: [['dashboard']],
    onError: (err) => {
      setError(err instanceof CamtechApiError ? err.message : errorMessage(err));
      return true;
    },
  });
  const valid = days !== null && Number.isInteger(days) && days >= s.min && days <= s.max;
  const dirty = days !== s.expiryWarningDays;
  return (
    <Card>
      {error && <Alert type="error" showIcon title={error} closable={{ onClose: () => setError(null) }} style={{ marginBottom: 12 }} />}
      <Form layout="vertical" requiredMark={false} onFinish={() => valid && save.mutate(days)}>
        <Form.Item
          label={
            <Flex gap={8} align="center">
              {t('documentSettings.warning')}
              {s.expiryWarningDays === s.defaultExpiryWarningDays && <Tag variant="filled" className="ct-pill">{t('documentSettings.default')}</Tag>}
            </Flex>
          }
          extra={t('documentSettings.warning.extra', { min: s.min, max: s.max, def: s.defaultExpiryWarningDays })}
          validateStatus={valid ? undefined : 'error'}
        >
          <InputNumber
            min={s.min}
            max={s.max}
            precision={0}
            value={days}
            onChange={(v) => {
              setError(null);
              setDays(typeof v === 'number' ? v : null);
            }}
            disabled={!canBuild}
            suffix={t('documentSettings.days')}
            style={{ width: 180 }}
            aria-label={t('documentSettings.warning')}
          />
        </Form.Item>
      </Form>
      <Flex gap={16} wrap>
        <Link to={`/documents?expiringBefore=${expiringBeforeFor(s.expiryWarningDays)}`}>{t('documents.expiringSoon', { days: s.expiryWarningDays })}</Link>
        <Typography.Text type="secondary" className="ct-meta">
          DOCUMENT_EXPIRING · <Link to="/webhooks">Webhooks</Link>
        </Typography.Text>
      </Flex>
      {canBuild && (
        <SaveBar dirty={dirty} invalid={!valid} saving={save.isPending} onSave={() => valid && save.mutate(days)} onDiscard={() => setDays(s.expiryWarningDays)} />
      )}
    </Card>
  );
}

/** Settings › Document expiry: when a document counts as expiring soon. */
export function DocumentSettingsSection() {
  const q = useDocumentSettings();
  const { canBuild } = usePermissions();
  return (
    <>
      <SectionTitle title={t('documentSettings.title')} sub={t('documentSettings.help')} />
      {!canBuild && <ReadOnlyNotice />}
      <DataState query={q} rows={3}>
        {(s) => <WarningForm s={s} />}
      </DataState>
    </>
  );
}
