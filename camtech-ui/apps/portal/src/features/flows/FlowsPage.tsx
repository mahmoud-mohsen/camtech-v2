import { CaretRightOutlined } from '@ant-design/icons';
import { CamtechApiError, errorMessage, type ChallengeAction, type DuplicateSearchSettings, type LivenessMode, type LivenessSettings, type TenantFlowLiveness } from '@camtech/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Empty, Flex, Form, InputNumber, Radio, Switch, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar } from '../../components/SaveBar';
import { FORM_WIDTH } from '../../components/ui';
import { t, type MessageKey } from '../../i18n';
import { qk, useApiMutation } from '../../lib/hooks';
import { flowLabel } from '../../lib/labels';
import { ACTIVE_ONLY_FLOWS, actionLabel, countBounds, defaultMode, drawHint, modeLabel, selectableModes, sortActions, validateLiveness } from '../../lib/liveness';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';

const PURPOSE_FLOWS = ['SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'];

/** What the flow is for and when to use it, so the tenant can tell the flows apart. */
function FlowPurpose({ flowCode }: { flowCode: string }) {
  if (!PURPOSE_FLOWS.includes(flowCode)) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Paragraph style={{ marginBottom: 4 }}>{t(`flows.purpose.${flowCode}` as MessageKey)}</Typography.Paragraph>
      <Typography.Text type="secondary">
        <Typography.Text strong type="secondary">
          {t('flows.useFor')}:
        </Typography.Text>{' '}
        {t(`flows.useFor.${flowCode}` as MessageKey)}
      </Typography.Text>
    </div>
  );
}

const settingsKey = (s: LivenessSettings) => JSON.stringify({ mode: s.mode, actions: sortActions(s.actions), challengeCount: s.challengeCount });

function FlowCard({ flow }: { flow: TenantFlowLiveness }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const saved: LivenessSettings = { mode: flow.mode, actions: sortActions(flow.actions), challengeCount: flow.challengeCount };
  const [draft, setDraft] = useState<LivenessSettings>(saved);
  const [serverError, setServerError] = useState<{ code: string; message: string } | null>(null);
  const { policy } = flow;
  const name = flow.flowName || flowLabel(flow.flowCode);

  const modes = selectableModes(flow.flowCode, policy);
  const recommended = defaultMode(policy, flow.flowCode);
  const activeOnly = ACTIVE_ONLY_FLOWS.includes(flow.flowCode);
  const options = sortActions(policy.allowedActions);
  const bounds = countBounds(policy, draft.actions.length);
  const issue = validateLiveness(flow.flowCode, draft, policy);
  const dirty = settingsKey(draft) !== settingsKey(saved);

  const { canBuild } = usePermissions();
  const update = (patch: Partial<LivenessSettings>) => {
    setServerError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const save = useApiMutation((body: LivenessSettings) => api.updateFlowLiveness(flow.flowCode, body), {
    success: t('flows.savedToast', { flow: name }),
    onSuccess: (r) => qc.setQueryData<TenantFlowLiveness[]>(qk.flows, (list) => list?.map((f) => (f.flowCode === r.flowCode ? r : f))),
    onError: (err) => {
      setServerError({ code: err instanceof CamtechApiError ? err.code : 'ERROR', message: errorMessage(err) });
      return true;
    },
  });

  return (
    <Card
      size="small"
      title={
        <Flex gap={8} align="center" wrap>
          <span>{name}</span>
          {!flow.customized ? (
            <Tag variant="filled" className="ct-pill">
              {t('flows.defaults')}
            </Tag>
          ) : (
            flow.updatedAt && (
              <span className="ct-meta" style={{ fontWeight: 'normal' }}>
                {t('flows.saved')} <DateText value={flow.updatedAt} relative />
              </span>
            )
          )}
        </Flex>
      }
      extra={
        canBuild && (
          <Tooltip title={t('flows.tryIt.tooltip')}>
            <Button size="small" icon={<CaretRightOutlined />} onClick={() => navigate(`/playground?flow=${encodeURIComponent(flow.flowCode)}`)}>
              {t('flows.tryIt')}
            </Button>
          </Tooltip>
        )
      }
    >
      <FlowPurpose flowCode={flow.flowCode} />
      <Form layout="vertical" requiredMark={false} component="div" disabled={!canBuild}>
        <Form.Item label={t('flows.mode')} extra={activeOnly ? t('liveness.activeOnly') : undefined}>
          <Radio.Group value={draft.mode} onChange={(e) => update({ mode: e.target.value as LivenessMode })}>
            <Flex vertical gap={8}>
              {modes.map((m) => (
                <Radio key={m} value={m}>
                  <span>
                    {modeLabel(m)}
                    {modes.length > 1 && m === recommended && (
                      <Tag variant="filled" className="ct-pill" style={{ marginInlineStart: 8 }}>
                        {t('flows.default')}
                      </Tag>
                    )}
                    <br />
                    <span className="ct-meta">{t(m === 'ACTIVE' ? 'liveness.mode.ACTIVE.help' : 'liveness.mode.PASSIVE.help')}</span>
                  </span>
                </Radio>
              ))}
            </Flex>
          </Radio.Group>
        </Form.Item>

        {draft.mode === 'PASSIVE' ? (
          <Alert type="info" showIcon title={t('flows.passiveNote')} style={{ marginBottom: 16 }} />
        ) : (
          <>
            <Form.Item label={t('flows.challenges')} extra={t('flows.challenges.extra')}>
              <Checkbox.Group
                value={draft.actions}
                onChange={(v) => update({ actions: sortActions(v as ChallengeAction[]) })}
                options={options.map((a) => ({ value: a, label: actionLabel(a) }))}
              />
            </Form.Item>
            <Form.Item label={t('flows.count')} extra={t('flows.count.extra', { min: policy.minActions, max: policy.maxActions })} style={{ marginBottom: 8 }}>
              <InputNumber
                min={bounds.min}
                max={bounds.max}
                precision={0}
                value={draft.challengeCount}
                onChange={(v) => update({ challengeCount: v ?? bounds.min })}
                aria-label={t('flows.count')}
              />
            </Form.Item>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
              {drawHint(draft.challengeCount, draft.actions.length)}
            </Typography.Paragraph>
          </>
        )}

        {issue && <Alert type="warning" showIcon title={issue.message} style={{ marginBottom: 16 }} />}
        {serverError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            title={t('flows.saveFailed')}
            description={
              <span>
                <Typography.Text code>{serverError.code}</Typography.Text> {serverError.message}
              </span>
            }
          />
        )}

        {canBuild && (
          <SaveBar
            dirty={dirty}
            invalid={!!issue}
            saving={save.isPending}
            saveLabel={t('flows.save')}
            onSave={() => save.mutate({ ...draft, actions: sortActions(draft.actions) })}
            onDiscard={() => {
              setServerError(null);
              setDraft(saved);
            }}
          />
        )}
      </Form>
    </Card>
  );
}

/** Tenant-wide on/off for the DEDUP_SEARCH step; shown only when it is in the tenant's plan. */
function DuplicateSearchCard() {
  const qc = useQueryClient();
  const { canBuild } = usePermissions();
  const q = useQuery({ queryKey: qk.duplicateSearch, queryFn: api.duplicateSearch });
  const save = useApiMutation((enabled: boolean) => api.updateDuplicateSearch(enabled), {
    success: (r) => t(r.enabled ? 'dedup.savedOn' : 'dedup.savedOff'),
    onSuccess: (r) => qc.setQueryData<DuplicateSearchSettings>(qk.duplicateSearch, r),
  });
  const d = q.data;
  if (!d?.available || d.flows.length === 0) return null;
  return (
    <Card
      size="small"
      style={{ maxWidth: FORM_WIDTH, marginBottom: 16 }}
      title={t('dedup.title')}
      extra={
        <Flex gap={8} align="center">
          <Typography.Text type="secondary">{t(d.enabled ? 'dedup.on' : 'dedup.off')}</Typography.Text>
          <Switch checked={d.enabled} disabled={!canBuild} loading={save.isPending} onChange={(v) => save.mutate(v)} aria-label={t('dedup.title')} />
        </Flex>
      }
    >
      <Typography.Paragraph style={{ marginBottom: 4 }}>{t('dedup.help')}</Typography.Paragraph>
      <Typography.Text type="secondary">
        <Typography.Text strong type="secondary">
          {t('dedup.appliesTo')}:
        </Typography.Text>{' '}
        {d.flows.map(flowLabel).join(', ')}. {t('dedup.reviewNote')}
      </Typography.Text>
    </Card>
  );
}

export default function FlowsPage() {
  const q = useQuery({ queryKey: qk.flows, queryFn: api.flows });
  const { canBuild } = usePermissions();
  return (
    <>
      <PageHeader title={t('flows.title')} help={t('flows.help')} />
      {!canBuild && <ReadOnlyNotice />}
      <DuplicateSearchCard />
      <DataState query={q} rows={8} isEmpty={(list) => list.length === 0} empty={<Empty description={t('flows.empty')} />}>
        {(list) => (
          <Flex vertical gap={16} style={{ maxWidth: FORM_WIDTH }}>
            {list.map((f) => (
              // Remount when the saved version changes, so the draft starts from it.
              <FlowCard key={`${f.flowCode}-${f.updatedAt ?? 'defaults'}`} flow={f} />
            ))}
          </Flex>
        )}
      </DataState>
    </>
  );
}
