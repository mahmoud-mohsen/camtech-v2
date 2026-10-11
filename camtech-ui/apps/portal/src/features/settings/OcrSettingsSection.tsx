import { CamtechApiError, errorMessage, type DocumentOcrSettings, type OcrReviewMode, type TenantDocumentOcrSettings } from '@camtech/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Flex, Form, InputNumber, Popconfirm, Radio, Select, Space, Switch, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { SaveBar } from '../../components/SaveBar';
import { SectionTitle } from '../../components/ui';
import { qk, useApiMutation } from '../../lib/hooks';
import { fieldLabel, OCR_REVIEW_MODE_LABELS, REQUIRABLE_FIELDS } from '../../lib/labels';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { t } from '../../i18n';

const MODE_HELP: Record<OcrReviewMode, string> = {
  AUTO: 'Scans that pass every check are accepted at once. A scan waits for review when a value fails its check (wrong ID check digit, impossible date, front and back of different cards...), a required field is missing, the card has expired, or the confidence is below your thresholds.',
  ALWAYS: 'Every scan waits until someone in your team approves it. Use while you build trust in the automatic checks.',
  NEVER: 'No scan is held. The checks still run and are shown on each scan, but values are used even when a check fails.',
};

const key = (s: DocumentOcrSettings) => JSON.stringify({ ...s, requiredFields: [...s.requiredFields].sort() });

function SettingsForm({ data }: { data: TenantDocumentOcrSettings }) {
  const qc = useQueryClient();
  const { canBuild } = usePermissions();
  const [draft, setDraft] = useState<DocumentOcrSettings>(data.settings);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(data.settings), [data.settings]);
  const dirty = key(draft) !== key(data.settings);
  const useDocumentDefault = draft.requiredFields.length === 0;
  const update = (patch: Partial<DocumentOcrSettings>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const onError = (err: unknown) => {
    setError(err instanceof CamtechApiError ? err.message : errorMessage(err));
    return true;
  };
  const save = useApiMutation((body: DocumentOcrSettings) => api.updateDocumentOcrSettings(body), {
    success: 'Review settings saved',
    onSuccess: (r) => qc.setQueryData(qk.ocrSettings, r),
    onError,
  });
  const reset = useApiMutation(() => api.resetDocumentOcrSettings(), {
    success: 'Review settings reset to the defaults',
    onSuccess: (r) => qc.setQueryData(qk.ocrSettings, r),
    onError,
  });

  return (
    <Card>
      <SectionTitle
        title="Document review"
        extra={
          !data.customized ? (
            <Tag variant="filled" className="ct-pill">
              Defaults
            </Tag>
          ) : (
            data.updatedAt && (
              <span className="ct-meta">
                Saved <DateText value={data.updatedAt} relative />
              </span>
            )
          )
        }
      />
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} closable onClose={() => setError(null)} />}
      <Form layout="vertical" disabled={!canBuild}>
        <Form.Item label="Hold scans for review" extra={MODE_HELP[draft.reviewMode]}>
          <Radio.Group
            value={draft.reviewMode}
            onChange={(e) => update({ reviewMode: e.target.value as OcrReviewMode })}
            options={data.reviewModes.map((m) => ({ value: m, label: OCR_REVIEW_MODE_LABELS[m] ?? m }))}
          />
        </Form.Item>
        <Space size={24} wrap align="start">
          <Form.Item
            label="Accept automatically from"
            extra="Overall confidence of the scan (0-100%). Below this, the scan waits for review."
            style={{ maxWidth: 360 }}
          >
            <InputNumber
              min={0}
              max={100}
              step={1}
              suffix="%"
              disabled={draft.reviewMode !== 'AUTO'}
              value={Math.round(draft.autoAcceptConfidence * 100)}
              onChange={(v) => update({ autoAcceptConfidence: (v ?? 0) / 100 })}
            />
          </Form.Item>
          <Form.Item label="Minimum per required field" extra="Each required field must reach this confidence." style={{ maxWidth: 360 }}>
            <InputNumber
              min={0}
              max={100}
              step={1}
              suffix="%"
              disabled={draft.reviewMode !== 'AUTO'}
              value={Math.round(draft.fieldMinConfidence * 100)}
              onChange={(v) => update({ fieldMinConfidence: (v ?? 0) / 100 })}
            />
          </Form.Item>
        </Space>
        <Form.Item
          label="Required fields"
          extra={
            useDocumentDefault
              ? 'Each document side requires its own: front = ID number and name; back = ID number, birth and expiry dates; both sides = all four.'
              : 'Every scan must yield these fields, or it waits for review.'
          }
        >
          <Flex vertical gap={8}>
            <Checkbox checked={useDocumentDefault} onChange={(e) => update({ requiredFields: e.target.checked ? [] : ['emiratesIdNumber', 'fullNameEn'] })}>
              Use each document&apos;s own required fields
            </Checkbox>
            {!useDocumentDefault && (
              <Select
                mode="multiple"
                style={{ maxWidth: 560 }}
                value={draft.requiredFields}
                onChange={(v: string[]) => update({ requiredFields: v })}
                options={REQUIRABLE_FIELDS.map((f) => ({ value: f, label: fieldLabel(f) }))}
              />
            )}
          </Flex>
        </Form.Item>
        <Form.Item label="Expired documents" extra="When off, an expired card always waits for review.">
          <Space>
            <Switch checked={draft.acceptExpired} onChange={(v) => update({ acceptExpired: v })} />
            <Typography.Text>{draft.acceptExpired ? 'Accept expired documents' : 'Review expired documents'}</Typography.Text>
          </Space>
        </Form.Item>
      </Form>
      {canBuild && (
        <SaveBar
          dirty={dirty}
          saving={save.isPending}
          onSave={() => save.mutate(draft)}
          onDiscard={() => setDraft(data.settings)}
          extra={
            data.customized && (
              <Popconfirm title="Reset to the defaults?" okText="Reset" onConfirm={() => reset.mutate(undefined)}>
                <Button type="text" loading={reset.isPending}>
                  Reset to defaults
                </Button>
              </Popconfirm>
            )
          }
        />
      )}
    </Card>
  );
}

/** Settings › Document checks: when scan results are accepted on their own and when they wait for review. */
export function OcrSettingsSection() {
  const q = useQuery({ queryKey: qk.ocrSettings, queryFn: api.documentOcrSettings });
  const { canBuild } = usePermissions();
  return (
    <>
      <SectionTitle
        title={t('settings.tab.ocr')}
        sub="When scan results are accepted on their own, and when someone in your team checks them first. The checks themselves (ID check digit, dates, both sides agreeing) are built in."
      />
      {!canBuild && <ReadOnlyNotice />}
      <DataState query={q} rows={8}>
        {(data) => <SettingsForm data={data} />}
      </DataState>
    </>
  );
}
