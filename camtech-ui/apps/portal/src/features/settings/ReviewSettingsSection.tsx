import type { ReviewOwner } from '@camtech/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Radio, Typography } from 'antd';
import { useState } from 'react';
import { DataState } from '../../components/DataState';
import { SaveBar } from '../../components/SaveBar';
import { SectionTitle } from '../../components/ui';
import { t, type MessageKey } from '../../i18n';
import { qk, useApiMutation } from '../../lib/hooks';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';

function OwnerForm({ current, owners }: { current: ReviewOwner; owners: ReviewOwner[] }) {
  const qc = useQueryClient();
  const { isOwner } = usePermissions();
  const [draft, setDraft] = useState<ReviewOwner>(current);
  const [synced, setSynced] = useState(current);
  if (current !== synced) {
    setSynced(current);
    setDraft(current);
  }
  const save = useApiMutation((owner: ReviewOwner) => api.updateReviewSettings(owner), {
    success: t('reviewSettings.saved'),
    onSuccess: (r) => qc.setQueryData(qk.reviewSettings, r),
    invalidate: [qk.reviewSummary, ['review-cases'], ['review-case'], ['dashboard']],
  });
  return (
    <Card>
      {!isOwner && <Alert type="info" showIcon title={t('reviewSettings.ownerOnly')} style={{ marginBottom: 16 }} />}
      <Radio.Group value={draft} onChange={(e) => setDraft(e.target.value as ReviewOwner)} disabled={!isOwner} style={{ display: 'grid', gap: 16 }}>
        {owners.map((o) => (
          <Radio key={o} value={o} style={{ alignItems: 'flex-start' }}>
            <Typography.Text strong>{t(`reviewSettings.${o}` as MessageKey)}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0', maxWidth: 720 }}>
              {t(`reviewSettings.${o}.help` as MessageKey)}
            </Typography.Paragraph>
          </Radio>
        ))}
      </Radio.Group>
      <Typography.Paragraph type="secondary" className="ct-meta" style={{ marginTop: 16 }}>
        {t('reviewSettings.openNote')}
      </Typography.Paragraph>
      {isOwner && <SaveBar dirty={draft !== current} saving={save.isPending} onSave={() => save.mutate(draft)} onDiscard={() => setDraft(current)} />}
    </Card>
  );
}

/** Settings › Reviews: who decides the verifications that need a person. */
export function ReviewSettingsSection() {
  const q = useQuery({ queryKey: qk.reviewSettings, queryFn: api.reviewSettings });
  return (
    <>
      <SectionTitle title={t('reviewSettings.title')} sub={t('reviewSettings.help')} />
      <DataState query={q} rows={4}>
        {(s) => <OwnerForm current={s.owner} owners={s.owners.length ? s.owners : ['TENANT', 'CAMTECH']} />}
      </DataState>
    </>
  );
}
