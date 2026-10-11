import { Flex, Tag, theme, Tooltip, Typography } from 'antd';
import { TONE_HEX } from '../lib/colors';
import { DEFAULT_THRESHOLDS, type SimilarityThresholds } from '../lib/hooks';
import { BAND_INFO, similarityBand } from '../lib/similarity';

interface Props {
  value: number | null | undefined;
  thresholds?: SimilarityThresholds;
  size?: 'small' | 'large';
}

/**
 * Similarity on a 0..1 band bar: NO_MATCH < review ≤ REVIEW < match ≤ MATCH, excellent ≥ excellent.
 */
export function SimilarityBand({ value, thresholds = DEFAULT_THRESHOLDS, size = 'small' }: Props) {
  const { token } = theme.useToken();
  const large = size === 'large';
  const h = large ? 14 : 8;
  if (value === null || value === undefined) return <Typography.Text type="secondary">No similarity score</Typography.Text>;
  const v = Math.max(0, Math.min(1, value));
  const band = similarityBand(v, thresholds);
  const info = BAND_INFO[band];
  const pct = (x: number) => `${x * 100}%`;
  const zones = [
    { from: 0, to: thresholds.review, color: TONE_HEX.error, label: 'No match' },
    { from: thresholds.review, to: thresholds.match, color: TONE_HEX.warning, label: 'Review' },
    { from: thresholds.match, to: thresholds.excellent, color: '#95de64', label: 'Match' },
    { from: thresholds.excellent, to: 1, color: TONE_HEX.success, label: 'Excellent' },
  ];
  return (
    <div style={{ width: '100%' }}>
      <Flex align="baseline" gap={10} wrap style={{ marginBottom: large ? 10 : 4 }}>
        <span className="tabular" style={{ fontSize: large ? 28 : 14, fontWeight: 600, lineHeight: 1 }}>
          {v.toFixed(3)}
        </span>
        <Tooltip title={info.help}>
          <Tag color={info.color} style={{ marginInlineEnd: 0 }}>
            {info.label}
          </Tag>
        </Tooltip>
      </Flex>
      <div style={{ position: 'relative', height: h + (large ? 22 : 0), paddingTop: 0 }}>
        <div style={{ display: 'flex', height: h, borderRadius: h / 2, overflow: 'hidden', gap: 2, background: token.colorBgContainer }}>
          {zones.map((z) => (
            <Tooltip key={z.label} title={`${z.label}: ${z.from.toFixed(2)} – ${z.to.toFixed(2)}`}>
              <div style={{ width: pct(z.to - z.from), background: z.color, opacity: 0.85 }} />
            </Tooltip>
          ))}
        </div>
        <div
          aria-label={`Similarity ${v.toFixed(3)}`}
          style={{
            position: 'absolute', left: `calc(${pct(v)} - ${large ? 3 : 2}px)`, top: -4, width: large ? 6 : 4, height: h + 8,
            background: token.colorText, borderRadius: 3, boxShadow: `0 0 0 2px ${token.colorBgContainer}`,
          }}
        />
        {large && (
          <div style={{ position: 'relative', height: 18, marginTop: 4, fontSize: 12, color: token.colorTextSecondary }} className="tabular">
            {[thresholds.review, thresholds.match, thresholds.excellent].map((t) => (
              <span key={t} style={{ position: 'absolute', left: pct(t), transform: 'translateX(-50%)' }}>
                {t.toFixed(2)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
