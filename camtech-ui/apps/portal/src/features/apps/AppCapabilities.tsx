import type { ClientApp } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Descriptions, Flex, Segmented, Tag, Typography } from 'antd';
import { useState } from 'react';
import { DataState } from '../../components/DataState';
import { JsonBlock } from '../../components/Misc';
import { CodeLabel } from '../../components/Tags';
import { qk } from '../../lib/hooks';
import { channelLabel, docTypeLabel, featureLabel, flowLabel, stepLabel } from '../../lib/labels';
import { api } from '../../api/client';

/** Exactly what this app receives from GET /v2/capabilities: plan ∩ permissions ∩ status. */
export function AppCapabilities({ app }: { app: ClientApp }) {
  const q = useQuery({ queryKey: qk.capabilities(app.id), queryFn: () => api.appCapabilities(app.id) });
  const [view, setView] = useState<'cards' | 'json'>('cards');
  return (
    <DataState query={q}>
      {(c) => (
        <Flex vertical gap={12}>
          <Flex justify="space-between" align="center" gap={8} wrap>
            <Typography.Text type="secondary">
              What the app gets from <Typography.Text code>GET /v2/capabilities</Typography.Text>.
            </Typography.Text>
            <Segmented size="small" value={view} onChange={(v) => setView(v as 'cards' | 'json')} options={[{ value: 'cards', label: 'Summary' }, { value: 'json', label: 'JSON' }]} />
          </Flex>
          {view === 'json' ? (
            <JsonBlock value={c} maxHeight={560} />
          ) : (
            <>
              <Descriptions
                size="small"
                column={{ xs: 1, sm: 2 }}
                items={[
                  { label: 'Channel', children: channelLabel(c.channel) },
                  { label: 'Languages', children: c.locales.join(', ') || '—' },
                  {
                    label: 'Features',
                    span: 2,
                    children: c.features.length ? (
                      <Flex gap={4} wrap>
                        {c.features.map((f) => (
                          <Tag key={f} title={f} variant="filled" className="ct-pill">
                            {featureLabel(f)}
                          </Tag>
                        ))}
                      </Flex>
                    ) : (
                      'None'
                    ),
                  },
                ]}
              />
              {c.flows.length === 0 && <Alert type="warning" showIcon title="This app can't run any flow. Check its status and permissions." />}
              {c.flows.map((f) => (
                <Card key={f.code} size="small" title={<CodeLabel label={flowLabel(f.code)} code={f.code} />}>
                  <Descriptions
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                    items={[
                      { label: 'Steps', span: 2, children: f.steps.map(stepLabel).join(' → ') || '—' },
                      { label: 'Documents', span: 2, children: f.documents.length ? f.documents.map(docTypeLabel).join(', ') : 'None' },
                      { label: 'Selfie attempts', children: f.settings.livenessMaxAttempts },
                      { label: 'Document attempts', children: f.settings.documentMaxAttempts },
                      { label: 'Session time', children: `${f.settings.sessionTtlMinutes} min` },
                      { label: 'Upload from file', children: f.settings.fileUploadAllowed ? 'Allowed' : 'Camera only' },
                      { label: 'Device anti-spoof', children: f.settings.deviceAntispoofRequired ? 'Required' : 'Not required' },
                      ...(f.settings.faceEnrollmentAvailable !== undefined
                        ? [{ label: 'Registers the face', children: f.settings.faceEnrollmentAvailable ? 'Yes, unless enrollFace: false' : 'No (face registration not allowed)' }]
                        : []),
                      {
                        label: 'Daily quota',
                        children: f.quota.perDay === null ? <Tag color="blue" variant="filled" className="ct-pill">Unlimited</Tag> : `${f.quota.remainingToday ?? '?'} of ${f.quota.perDay} left today`,
                      },
                    ]}
                  />
                </Card>
              ))}
            </>
          )}
        </Flex>
      )}
    </DataState>
  );
}
