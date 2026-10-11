import { UndoOutlined, WarningOutlined } from '@ant-design/icons';
import type { Branding, Lang } from '@camtech/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Card, Col, ColorPicker, Flex, Form, Input, Modal, Row, Segmented, Select, Slider, Switch, Tabs, Tag, theme, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { SaveBar } from '../../components/SaveBar';
import { AA_NORMAL, contrastRatio, textContrastOn } from '../../lib/contrast';
import { qk, useApiMutation } from '../../lib/hooks';
import { api } from '../../api/client';
import { usePermissions, useTenantInfo } from '../../auth/useAuth';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { brandingKey, FONT_OPTIONS, LANGS, TEXT_KEYS, TEXT_LABELS, TEXT_PLACEHOLDERS, toFormValues, toUpdate, type BrandingFormValues } from './brandingForm';
import { BrandingPreview } from './BrandingPreview';
import { LogoInput } from './LogoInput';

const COLOR_FIELDS = [
  { name: 'primaryColor', label: 'Primary', help: 'Buttons, progress and focus' },
  { name: 'accentColor', label: 'Accent', help: 'Highlights and the capture guide' },
  { name: 'backgroundColor', label: 'Background', help: 'Page background' },
  { name: 'surfaceColor', label: 'Surface', help: 'Cards and panels' },
  { name: 'textColor', label: 'Text', help: 'Body text' },
] as const;

function RatioTag({ ratio, what }: { ratio: number | null; what: string }) {
  if (ratio === null) return null;
  const ok = ratio >= AA_NORMAL;
  return (
    <Tooltip title={`${what}: ${ok ? 'meets WCAG AA (4.5:1)' : 'below WCAG AA (4.5:1), hard to read for many people'}`}>
      <Tag color={ok ? 'success' : 'warning'} variant="filled" className="ct-pill tabular">
        {ratio.toFixed(1)}:1
      </Tag>
    </Tooltip>
  );
}

function ContrastWarnings({ v }: { v: BrandingFormValues }) {
  const onPrimary = textContrastOn(v.primaryColor);
  const textBg = contrastRatio(v.textColor, v.backgroundColor);
  const textSurface = contrastRatio(v.textColor, v.surfaceColor);
  const issues: string[] = [];
  if (onPrimary && onPrimary.white < AA_NORMAL) {
    issues.push(
      `White button text on the primary colour is only ${onPrimary.white.toFixed(1)}:1 (black text would be ${onPrimary.black.toFixed(1)}:1). Pick a darker primary.`,
    );
  }
  if (textBg !== null && textBg < AA_NORMAL) issues.push(`Text on the background is ${textBg.toFixed(1)}:1.`);
  if (textSurface !== null && textSurface < AA_NORMAL) issues.push(`Text on cards (surface) is ${textSurface.toFixed(1)}:1.`);
  if (!issues.length) return null;
  return (
    <Alert
      type="warning"
      showIcon
      icon={<WarningOutlined />}
      title="Some colours are hard to read (WCAG AA needs 4.5:1)"
      description={
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      }
    />
  );
}

function BrandingEditor({ saved }: { saved: Branding }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const info = useTenantInfo();
  const { canBuild } = usePermissions();
  const qc = useQueryClient();
  const [form] = Form.useForm<BrandingFormValues>();
  const initial = useMemo(() => toFormValues(saved), [saved]);
  const [draft, setDraft] = useState<BrandingFormValues>(initial);
  const [textLang, setTextLang] = useState<Lang>('en');

  useEffect(() => {
    form.setFieldsValue(initial);
    setDraft(initial);
  }, [initial, form]);

  const sync = () => setDraft({ ...(form.getFieldsValue(true) as BrandingFormValues) });
  const dirty = brandingKey(toUpdate(draft)) !== brandingKey(toUpdate(initial));

  // Unsaved-changes guard: in-app navigation and tab close / reload.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = useApiMutation((v: BrandingFormValues) => api.updateBranding(toUpdate(v)), {
    success: 'Branding saved. New verifications use it right away.',
    onSuccess: (b) => qc.setQueryData(qk.branding, b),
  });
  const reset = useApiMutation(() => api.resetBranding(), {
    success: 'Branding reset to the CamTech defaults',
    invalidate: [qk.branding],
  });

  const preview: Branding = useMemo(() => ({ ...toUpdate(draft), tenant: info.code, updatedAt: saved.updatedAt }), [draft, info.code, saved.updatedAt]);

  const submit = async () => {
    try {
      const v = await form.validateFields();
      save.mutate({ ...(form.getFieldsValue(true) as BrandingFormValues), ...v });
    } catch {
      message.error('Fix the highlighted fields first');
    }
  };

  const colorItem = (f: (typeof COLOR_FIELDS)[number]) => {
    const value = draft[f.name];
    const ratio = f.name === 'primaryColor' ? (textContrastOn(value)?.white ?? null) : f.name === 'textColor' ? contrastRatio(draft.textColor, draft.backgroundColor) : null;
    return (
      <Col xs={24} sm={12} key={f.name}>
        <Form.Item
          label={
            <Flex gap={6} align="center">
              {f.label} <RatioTag ratio={ratio} what={f.name === 'primaryColor' ? 'White text on the primary colour' : 'Text on the background'} />
            </Flex>
          }
          extra={f.help}
          style={{ marginBottom: 12 }}
        >
          <Form.Item name={f.name} noStyle getValueFromEvent={(_c: unknown, hex: string) => hex} rules={[{ required: true, pattern: /^#[0-9a-f]{6}$/i, message: 'Use a 6-digit hex colour' }]}>
            <ColorPicker format="hex" disabledAlpha showText disabledFormat aria-label={`${f.label} colour`} />
          </Form.Item>
        </Form.Item>
      </Col>
    );
  };

  return (
    <>
      <PageHeader
        title="Branding"
        help="How the verification screens look to your users. The preview on the right is the real SDK."
        tags={
          saved.updatedAt ? (
            <span className="ct-meta">
              Saved <DateText value={saved.updatedAt} relative />
            </span>
          ) : (
            <Tag variant="filled" className="ct-pill">
              Defaults
            </Tag>
          )
        }
        extra={
          canBuild && (
            <ConfirmAction
                label="Reset to defaults"
                buttonProps={{ icon: <UndoOutlined />, disabled: saved.updatedAt === null && !dirty }}
                title="Reset branding to the CamTech defaults?"
                description="Your logo, colours and texts are removed. Verifications started after this use the default look."
                okText="Reset"
                danger
                onConfirm={() => reset.mutateAsync(undefined)}
              />
          )
        }
      />
      {!canBuild && <ReadOnlyNotice />}
      <Row gutter={[20, 20]}>
        <Col xs={24} xl={13}>
          <Form<BrandingFormValues> form={form} layout="vertical" initialValues={initial} onValuesChange={sync} requiredMark={false} disabled={!canBuild}>
            <Flex vertical gap={16}>
              <Card title="Identity">
                <Form.Item name="displayName" label="Display name" extra="Shown on the welcome screen and in the header." rules={[{ required: true, whitespace: true, message: 'Enter a name' }, { max: 60 }]}>
                  <Input maxLength={60} showCount />
                </Form.Item>
                <Form.Item name="logoDataUrl" label="Logo" style={{ marginBottom: 0 }}>
                  <LogoInput />
                </Form.Item>
              </Card>

              <Card title="Colours">
                <Row gutter={16}>{COLOR_FIELDS.map(colorItem)}</Row>
                <ContrastWarnings v={draft} />
              </Card>

              <Card title="Shape and type">
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="fontFamily" label="Font">
                      <Select
                        options={FONT_OPTIONS.map((f) => ({ value: f, label: <span style={{ fontFamily: f }}>{f}</span> }))}
                        aria-label="Font"
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="themeMode" label="Theme" extra="Auto follows the user's device setting.">
                      <Segmented
                        options={[
                          { value: 'LIGHT', label: 'Light' },
                          { value: 'DARK', label: 'Dark' },
                          { value: 'AUTO', label: 'Auto' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="borderRadius" label={`Corner radius · ${draft.borderRadius}px`} style={{ marginBottom: 4 }}>
                  <Slider min={0} max={24} marks={{ 0: '0', 8: '8', 12: '12', 16: '16', 24: '24' }} tooltip={{ formatter: (v) => `${v}px` }} />
                </Form.Item>
              </Card>

              <Card title="Texts" extra={<span className="ct-meta">empty = CamTech default</span>}>
                <Tabs
                  activeKey={textLang}
                  onChange={(k) => setTextLang(k as Lang)}
                  items={LANGS.map((lang) => ({
                    key: lang,
                    label: lang === 'en' ? 'English' : 'العربية',
                    forceRender: true,
                    children: (
                      <div dir={lang === 'ar' ? 'rtl' : undefined}>
                        {TEXT_KEYS.map((k) => (
                          <Form.Item key={k} name={['texts', lang, k]} label={TEXT_LABELS[k]} rules={[{ max: k.endsWith('Title') ? 80 : 400 }]}>
                            {k.endsWith('Title') ? (
                              <Input dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} placeholder={TEXT_PLACEHOLDERS[lang][k]} maxLength={80} />
                            ) : (
                              <Input.TextArea dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} placeholder={TEXT_PLACEHOLDERS[lang][k]} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={400} />
                            )}
                          </Form.Item>
                        ))}
                      </div>
                    ),
                  }))}
                />
              </Card>

              <Card title="Support and legal">
                <Row gutter={16}>
                  <Col xs={24} sm={12}>
                    <Form.Item name="supportEmail" label="Support e-mail" rules={[{ type: 'email', message: 'Enter a valid e-mail address' }]}>
                      <Input placeholder="support@example.com" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="supportUrl" label="Help page" rules={[{ type: 'url', message: 'Enter a full URL (https://…)' }]}>
                      <Input placeholder="https://example.com/help" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="privacyUrl" label="Privacy notice" rules={[{ type: 'url', message: 'Enter a full URL (https://…)' }]} extra="Linked from the consent text before the camera opens.">
                      <Input placeholder="https://example.com/privacy" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} sm={12}>
                    <Form.Item name="showPoweredBy" label="“Powered by CamTech”" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            </Flex>
          </Form>
          {canBuild && (
            <SaveBar
              floating
              dirty={dirty}
              saving={save.isPending}
              saveLabel="Save branding"
              onSave={() => void submit()}
              onDiscard={() => {
                form.resetFields();
                form.setFieldsValue(initial);
                setDraft(initial);
              }}
            />
          )}
        </Col>
        <Col xs={24} xl={11}>
          <div style={{ position: 'sticky', top: 76 }}>
            <BrandingPreview branding={preview} />
            {dirty && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, color: token.colorWarningText }}>
                The preview shows your unsaved changes. End users see them only after you save.
              </Typography.Paragraph>
            )}
          </div>
        </Col>
      </Row>
      <Modal
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        okText="Leave page"
        okButtonProps={{ danger: true }}
        cancelText="Stay"
        onOk={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      >
        Your branding changes haven't been saved and will be lost.
      </Modal>
    </>
  );
}

export default function BrandingPage() {
  const q = useQuery({ queryKey: qk.branding, queryFn: api.branding });
  return (
    <DataState query={q} rows={14}>
      {(b) => <BrandingEditor saved={b} />}
    </DataState>
  );
}
