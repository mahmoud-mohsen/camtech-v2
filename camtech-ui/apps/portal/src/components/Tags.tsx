import { Tag, Tooltip } from 'antd';
import {
  ACTIVE_TONE, ACTOR_COLOR, DECISION_TONE, MATCH_COLOR, TEMPLATE_STATUS_TONE, DELIVERY_STATUS_TONE, DOC_STATUS_TONE, OUTCOME_TONE, REVIEW_STATUS_TONE,
  SCAN_STATUS_TONE, SESSION_STATUS_TONE, STEP_STATUS_TONE, VALIDATION_TONE, type Tone,
} from '../lib/colors';
import {
  ACTOR_LABELS, DECISION_LABELS, MATCH_LABELS, TEMPLATE_STATUS_LABELS, DELIVERY_STATUS_LABELS, DOC_STATUS_LABELS, humanize, OUTCOME_LABELS, REVIEW_STATUS_LABELS,
  SCAN_STATUS_LABELS, SESSION_STATUS_LABELS, STEP_STATUS_LABELS, VALIDATION_LABELS,
} from '../lib/labels';

interface ToneTagProps {
  code: string | null | undefined;
  labels?: Record<string, string>;
  tones: Record<string, Tone | string>;
  empty?: string;
}

/** A coloured tag showing a readable label; the raw code is in the tooltip. */
function ToneTag({ code, labels, tones, empty = '—' }: ToneTagProps) {
  if (!code) return <span style={{ opacity: 0.55 }}>{empty}</span>;
  const label = labels?.[code] ?? humanize(code);
  return (
    <Tooltip title={code} mouseEnterDelay={0.6}>
      <Tag color={tones[code] ?? 'default'} variant="filled" className="ct-pill">
        {label}
      </Tag>
    </Tooltip>
  );
}

type CodeProp = { value: string | null | undefined };

export const StatusTag = ({ value }: CodeProp) => <ToneTag code={value} labels={SESSION_STATUS_LABELS} tones={SESSION_STATUS_TONE} />;
export const DecisionTag = ({ value, empty = 'No decision' }: CodeProp & { empty?: string }) => (
  <ToneTag code={value} labels={DECISION_LABELS} tones={DECISION_TONE} empty={empty} />
);
export const ReviewStatusTag = ({ value }: CodeProp) => <ToneTag code={value} labels={REVIEW_STATUS_LABELS} tones={REVIEW_STATUS_TONE} />;
export const StepStatusTag = ({ value }: CodeProp) => <ToneTag code={value} labels={STEP_STATUS_LABELS} tones={STEP_STATUS_TONE} />;
export const OutcomeTag = ({ value }: CodeProp) => <ToneTag code={value} labels={OUTCOME_LABELS} tones={OUTCOME_TONE} />;
export const DocStatusTag = ({ value }: CodeProp) => <ToneTag code={value} labels={DOC_STATUS_LABELS} tones={DOC_STATUS_TONE} />;
export const ScanStatusTag = ({ value }: CodeProp) => <ToneTag code={value} labels={SCAN_STATUS_LABELS} tones={SCAN_STATUS_TONE} />;
export const DeliveryStatusTag = ({ value }: CodeProp) => <ToneTag code={value} labels={DELIVERY_STATUS_LABELS} tones={DELIVERY_STATUS_TONE} />;
export const ValidationTag = ({ value }: CodeProp) => <ToneTag code={value} labels={VALIDATION_LABELS} tones={VALIDATION_TONE} />;
export const ActiveTag = ({ value }: CodeProp) => <ToneTag code={value} tones={ACTIVE_TONE} />;
export const MatchLabelTag = ({ value }: CodeProp) => <ToneTag code={value} labels={MATCH_LABELS} tones={MATCH_COLOR} />;
export const TemplateStatusTag = ({ value }: CodeProp) => <ToneTag code={value} labels={TEMPLATE_STATUS_LABELS} tones={TEMPLATE_STATUS_TONE} />;
export const ActorTag = ({ value }: CodeProp) => <ToneTag code={value} labels={ACTOR_LABELS} tones={ACTOR_COLOR} />;

/** Readable label with the raw code shown as a subtle monospace tag next to it. */
export function CodeLabel({ label, code, hideCode }: { label: string; code: string | null | undefined; hideCode?: boolean }) {
  if (!code) return <span>—</span>;
  return (
    <span>
      {label}
      {!hideCode && label !== code && (
        <Tag variant="filled" style={{ marginInlineStart: 6, fontSize: 12, fontFamily: 'monospace', opacity: 0.75 }}>
          {code}
        </Tag>
      )}
    </span>
  );
}
