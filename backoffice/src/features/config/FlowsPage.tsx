import { Alert, Button, Card, Flex, InputNumber, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { catalogApi } from '../../api/configuration';
import type { Flow, FlowStep } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { ReadOnlyHint } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { CodeLabel } from '../../components/Tags';
import { useApiMutation, useFlows } from '../../lib/hooks';
import { featureLabel, stepLabel } from '../../lib/labels';

const STEP_HELP: Record<string, string> = {
  LIVENESS: 'Two selfies (normal and closer) to prove a live person is present.',
  DOC_CAPTURE: 'Photo of the document; the fields are read automatically.',
  DOC_VALIDATION: 'Checks expiry, number format and MRZ check digits.',
  FACE_DOC_MATCH: 'Compares the selfie with the photo on the document.',
  FACE_TEMPLATE_MATCH: "Compares the selfie with the person's enrolled face.",
  DEDUP_SEARCH: 'Looks for the same face registered to another person.',
};

/** Settings that override a step's max attempts (per flow, channel or client app). */
const ATTEMPTS_OVERRIDE: Record<string, string> = {
  LIVENESS: 'liveness.max_attempts',
  DOC_CAPTURE: 'document.max_attempts',
};

function MaxAttempts({ flow, step }: { flow: Flow; step: FlowStep }) {
  const { isAdmin } = usePermissions();
  const [max, setMax] = useState<number>(step.maxAttempts);
  const save = useApiMutation((maxAttempts: number) => catalogApi.updateFlowStep(flow.code, step.id, { maxAttempts }), {
    success: 'Flow saved',
    invalidate: [['flows'], ['capabilities']],
  });
  const override = ATTEMPTS_OVERRIDE[step.stepCode];
  return (
    <Flex vertical gap={2}>
      <Tooltip title={isAdmin ? undefined : 'Only administrators can change flows'}>
        <Flex gap={6} align="center">
          <Typography.Text type="secondary">Max attempts</Typography.Text>
          <InputNumber size="small" min={1} max={10} precision={0} value={max} disabled={!isAdmin} onChange={(v) => setMax(v ?? 1)} style={{ width: 70 }} />
          {isAdmin && max !== step.maxAttempts && (
            <Button size="small" type="primary" loading={save.isPending} onClick={() => save.mutate(max)}>
              Save
            </Button>
          )}
        </Flex>
      </Tooltip>
      {override && (
        <span className="ct-meta">
          Default. <Link to="/config/settings">Settings</Link> <Typography.Text code>{override}</Typography.Text> overrides it.
        </span>
      )}
    </Flex>
  );
}

function StepRules({ flow, step }: { flow: Flow; step: FlowStep }) {
  if (step.tenantSwitch) {
    return (
      <Flex vertical gap={2}>
        <span>
          <Tag variant="filled" className="ct-pill" color="blue">Per tenant</Tag>
        </span>
        <span className="ct-meta">
          Runs when {featureLabel(step.stepCode)} is in the tenant&apos;s plan and the tenant turns it on (
          <Typography.Text code>{step.tenantSwitch}</Typography.Text>).
        </span>
      </Flex>
    );
  }
  if (step.maxAttemptsUsed) return <MaxAttempts key={`${step.id}-${step.maxAttempts}`} flow={flow} step={step} />;
  return <span className="ct-meta">Runs once per session</span>;
}

export default function FlowsPage() {
  const q = useFlows();
  return (
    <>
      <PageHeader
        title="Flows"
        help="A flow is a verification journey: an ordered list of steps. The definitions are shared by every tenant; which flows a tenant may run is set in its plan on the Tenants page."
      />
      <ReadOnlyHint what="flows" />
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Changes on this page apply to all tenants." />
      <DataState query={q} isEmpty={(d) => d.length === 0}>
        {(flows) => (
          <Flex vertical gap={16}>
            {flows.map((f) => (
              <Card
                key={f.code}
                size="small"
                title={<CodeLabel label={f.name} code={f.code} />}
                extra={
                  <Tooltip title="Tenants with this flow in their plan">
                    <Tag variant="filled" className="ct-pill" color={f.enabledTenants > 0 ? 'success' : 'default'}>
                      {f.enabledTenants === 1 ? '1 tenant' : `${f.enabledTenants} tenants`}
                    </Tag>
                  </Tooltip>
                }
              >
                {f.description && <Typography.Paragraph type="secondary">{f.description}</Typography.Paragraph>}
                <Table<FlowStep>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={[...f.steps].sort((a, b) => a.seq - b.seq)}
                  scroll={{ x: 640 }}
                  columns={[
                    { title: '#', dataIndex: 'seq', width: 48, render: (v: number) => <span className="tabular">{v}</span> },
                    {
                      title: 'Step',
                      render: (_, s) => (
                        <div>
                          <CodeLabel label={stepLabel(s.stepCode)} code={s.stepCode} />
                          <div>
                            <span className="ct-meta">{STEP_HELP[s.stepCode]}</span>
                          </div>
                        </div>
                      ),
                    },
                    { title: 'Rules', width: 380, render: (_, s) => <StepRules flow={f} step={s} /> },
                  ]}
                />
              </Card>
            ))}
          </Flex>
        )}
      </DataState>
    </>
  );
}
