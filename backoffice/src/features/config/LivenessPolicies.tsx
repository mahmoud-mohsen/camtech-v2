import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Descriptions, Empty, Flex, Form, InputNumber, Row, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { livenessApi } from '../../api/configuration';
import type { AdminFlowLiveness, ChallengeAction, LivenessMode, LivenessPolicy, LivenessPolicyUpdate } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { useApiMutation } from '../../lib/hooks';
import { challengeActionLabel, livenessModeLabel } from '../../lib/labels';
import { ACTIVE_ONLY_FLOWS, ACTIVE_ONLY_REASON, CHALLENGE_ACTIONS, LIVENESS_MODES, livenessKey, MAX_ACTIONS, MIN_ACTIONS, settingsConflict, sortActions, validatePolicy } from './livenessLogic';

const policyKey = (p: LivenessPolicy) =>
  JSON.stringify({ ...p, allowedModes: LIVENESS_MODES.filter((m) => p.allowedModes.includes(m)), allowedActions: sortActions(p.allowedActions) });

/** The tenant's current settings for the flow, read-only (the tenant changes them in its portal). */
function TenantSettings({ item }: { item: AdminFlowLiveness }) {
  const s = item.settings;
  return (
    <Descriptions
      size="small"
      column={1}
      title={<Typography.Text type="secondary" style={{ fontSize: 13 }}>Tenant's current settings</Typography.Text>}
      items={[
        { label: 'Source', children: item.customized ? <Tag variant="filled" className="ct-pill" color="blue">Customised by the tenant</Tag> : <Tag variant="filled" className="ct-pill">Using defaults</Tag> },
        { label: 'Mode', children: livenessModeLabel(s.mode) },
        {
          label: 'Challenges',
          children:
            s.mode === 'PASSIVE' ? (
              <Typography.Text type="secondary">None (passive)</Typography.Text>
            ) : (
              <Flex gap={4} wrap>
                {sortActions(s.actions).map((a) => (
                  <Tag variant="filled" className="ct-pill" key={a} style={{ marginInlineEnd: 0 }}>
                    {challengeActionLabel(a)}
                  </Tag>
                ))}
              </Flex>
            ),
        },
        { label: 'Per user', children: s.mode === 'PASSIVE' ? '—' : `${s.challengeCount} of ${s.actions.length}, random order` },
        { label: 'Last updated', children: item.updatedAt ? <DateText value={item.updatedAt} relative /> : <Typography.Text type="secondary">Never</Typography.Text> },
      ]}
    />
  );
}

function PolicyCard({ item }: { item: AdminFlowLiveness }) {
  const { isAdmin } = usePermissions();
  const { modal } = App.useApp();
  const qc = useQueryClient();
  const saved = item.policy;
  const [draft, setDraft] = useState<LivenessPolicy>(saved);
  const activeOnly = ACTIVE_ONLY_FLOWS.includes(item.flowCode);
  const issue = validatePolicy(item.flowCode, draft);
  const dirty = policyKey(draft) !== policyKey(saved);
  // Only the tenant's own saved settings can conflict; defaults follow the policy.
  const conflict = item.customized && dirty ? settingsConflict(item.settings, draft) : null;
  const update = (patch: Partial<LivenessPolicy>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useApiMutation((body: LivenessPolicyUpdate) => livenessApi.update(item.tenantId, item.flowCode, body), {
    success: (r, v) => (v.resetTenant ? `${r.flowName}: liveness policy saved, tenant reset to the new defaults` : `${r.flowName}: liveness policy saved`),
    onSuccess: (r) => qc.setQueryData<AdminFlowLiveness[]>(livenessKey(item.tenantId), (list) => list?.map((x) => (x.flowCode === r.flowCode ? r : x))),
    onError: (err, v) => {
      if (!(err instanceof ApiError) || err.code !== 'TENANT_SETTINGS_CONFLICT' || v.resetTenant) return;
      modal.confirm({
        title: 'Reset the tenant’s liveness settings?',
        content: "This would invalidate the tenant's current settings. Reset the tenant to the new defaults?",
        okText: 'Save and reset tenant',
        okButtonProps: { danger: true },
        // Errors of the retry get the standard toast; the dialog closes either way.
        onOk: () => save.mutateAsync({ ...v, resetTenant: true }).catch(() => undefined),
      });
      return true;
    },
  });

  const body = (): LivenessPolicyUpdate => ({
    ...draft,
    allowedModes: LIVENESS_MODES.filter((m) => draft.allowedModes.includes(m)),
    allowedActions: sortActions(draft.allowedActions),
  });

  return (
    <Card
      size="small"
      title={
        <Flex gap={8} align="center" wrap>
          <span>Liveness policy · {item.flowName}</span>
          {dirty && <Tag variant="filled" className="ct-pill" color="gold">Unsaved changes</Tag>}
        </Flex>
      }
    >
      <Row gutter={[24, 16]}>
        <Col xs={24} lg={14}>
          <Form layout="vertical" disabled={!isAdmin} component="div">
            <Form.Item label="Allowed modes" extra="The modes the tenant may choose from." style={{ marginBottom: 12 }}>
              <Checkbox.Group value={draft.allowedModes} onChange={(v) => update({ allowedModes: v as LivenessMode[] })}>
                <Space size={16} wrap>
                  {LIVENESS_MODES.map((m) => {
                    const blocked = m === 'PASSIVE' && activeOnly;
                    return (
                      <Tooltip key={m} title={blocked ? ACTIVE_ONLY_REASON : undefined}>
                        <span>
                          <Checkbox value={m} disabled={blocked || !isAdmin}>
                            {livenessModeLabel(m)}
                          </Checkbox>
                        </span>
                      </Tooltip>
                    );
                  })}
                </Space>
              </Checkbox.Group>
            </Form.Item>
            <Form.Item label="Allowed challenges" extra="The challenges the tenant may select (used in active mode)." style={{ marginBottom: 12 }}>
              <Checkbox.Group
                value={draft.allowedActions}
                onChange={(v) => update({ allowedActions: sortActions(v as ChallengeAction[]) })}
                options={CHALLENGE_ACTIONS.map((a) => ({ value: a, label: challengeActionLabel(a) }))}
              />
            </Form.Item>
            <Flex gap={16} wrap>
              <Form.Item label="Min challenges per user" style={{ marginBottom: 12 }}>
                <InputNumber min={MIN_ACTIONS} max={MAX_ACTIONS} precision={0} value={draft.minActions} onChange={(v) => update({ minActions: v ?? MIN_ACTIONS })} />
              </Form.Item>
              <Form.Item label="Max challenges per user" style={{ marginBottom: 12 }}>
                <InputNumber min={MIN_ACTIONS} max={MAX_ACTIONS} precision={0} value={draft.maxActions} onChange={(v) => update({ maxActions: v ?? MAX_ACTIONS })} />
              </Form.Item>
            </Flex>
            <Form.Item
              label="Require one spare challenge"
              extra="The tenant must select at least one more challenge than each user does, so the set and the order vary between users."
              style={{ marginBottom: 12 }}
            >
              <Switch checked={draft.requireSpareAction} onChange={(v) => update({ requireSpareAction: v })} />
            </Form.Item>
          </Form>
          {issue && <Alert type="warning" showIcon title={issue.message} style={{ marginBottom: 12 }} />}
          {!issue && conflict && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              title="The tenant's saved settings don't fit these limits"
              description={`Saving will ask to reset the tenant to the new defaults (${conflict}).`}
            />
          )}
          <Flex gap={8}>
            <Tooltip title={isAdmin ? undefined : 'Only administrators can change this'}>
              <Button type="primary" disabled={!isAdmin || !dirty || !!issue} loading={save.isPending} onClick={() => save.mutate(body())}>
                Save policy
              </Button>
            </Tooltip>
            <Button disabled={!dirty} onClick={() => setDraft(saved)}>
              Discard
            </Button>
          </Flex>
        </Col>
        <Col xs={24} lg={10}>
          <TenantSettings item={item} />
        </Col>
      </Row>
    </Card>
  );
}

/** One "Liveness policy" card per liveness flow of a tenant. */
export function LivenessPolicies({ tenantId }: { tenantId: number }) {
  const q = useQuery({ queryKey: livenessKey(tenantId), queryFn: () => livenessApi.list(tenantId) });
  return (
    <DataState query={q} isEmpty={(l) => l.length === 0} empty={<Empty description="This tenant has no flow with a liveness check." />}>
      {(list) => (
        <Flex vertical gap={16}>
          {list.map((item) => (
            // Remount when the saved policy changes, so the draft starts from it.
            <PolicyCard key={`${item.flowCode}-${policyKey(item.policy)}-${item.updatedAt ?? ''}`} item={item} />
          ))}
        </Flex>
      )}
    </DataState>
  );
}
