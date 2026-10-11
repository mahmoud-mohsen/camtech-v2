import { useQuery } from '@tanstack/react-query';
import { Card, Col, Flex, Image, Row, Typography } from 'antd';
import { partiesApi } from '../api/operations';
import type { MediaRef, SessionDetail } from '../api/types';
import { formatSimilarity } from '../lib/format';
import { useSimilarityThresholds } from '../lib/hooks';
import { duplicateMatch, facePair, sessionSimilarity } from '../lib/session';
import { MediaImage } from './ImageViewer';
import { SimilarityBand } from './SimilarityBand';

interface Props {
  session: SessionDetail;
  /** Larger images for the review screen. */
  large?: boolean;
  title?: React.ReactNode;
}

/**
 * Without a document there is no portrait: compare with a registered face instead
 * (the person's own for face authentication, the matched person's for a duplicate).
 */
function useRegisteredFace(partyId: number | null, needed: boolean): MediaRef | null {
  const q = useQuery({
    queryKey: ['party', partyId],
    queryFn: () => partiesApi.get(partyId!),
    enabled: needed && partyId !== null,
  });
  const t = q.data?.faceTemplates.find((x) => x.status === 'ENROLLED' && x.sourceMediaId !== null);
  if (!t || t.sourceMediaId === null) return null;
  return { id: t.sourceMediaId, role: 'SELFIE_NORMAL', mimeType: 'image/jpeg', byteCount: 0, width: null, height: null, createdAt: t.createdAt };
}

/** Selfie vs document photo (or registered face) side by side, with the similarity on the band bar. */
export function FaceComparison({ session, large = false, title = 'Face comparison' }: Props) {
  const thresholds = useSimilarityThresholds();
  const pair = facePair(session);
  const templateFlow = session.steps.some((s) => s.stepCode === 'FACE_TEMPLATE_MATCH');
  const dup = pair.document || templateFlow ? null : duplicateMatch(session);
  const enrolled = useRegisteredFace(session.partyId, templateFlow && !pair.document);
  const matched = useRegisteredFace(dup?.partyId ?? null, dup !== null);
  const right = pair.document ?? (templateFlow ? enrolled : matched);
  const rightLabel = pair.document
    ? 'Document photo'
    : templateFlow
      ? 'Registered face'
      : dup
        ? `Registered to ${dup.partyName ?? `person #${dup.partyId}`}`
        : null;
  const similarity = sessionSimilarity(session);
  const size = large ? 300 : 200;
  const hasFaceMatch = session.steps.some((s) => s.stepCode === 'FACE_DOC_MATCH' || s.stepCode === 'FACE_TEMPLATE_MATCH');
  // Selfie only (liveness check, face registration without a duplicate): nothing to compare with.
  const selfieOnly = rightLabel === null && !session.steps.some((s) => s.stepCode === 'DOC_CAPTURE');

  return (
    <Card title={title}>
      <Image.PreviewGroup>
        <Row gutter={[16, 16]} justify="center">
          <Col xs={selfieOnly ? 24 : 12} style={{ display: 'flex', justifyContent: 'center' }}>
            <Flex vertical align="center" gap={6} style={{ width: "100%", maxWidth: size }}>
              <Typography.Text strong>Selfie</Typography.Text>
              <MediaImage media={pair.selfie} width="100%" height={size * 1.2} caption={false} />
            </Flex>
          </Col>
          {!selfieOnly && (
            <Col xs={12} style={{ display: 'flex', justifyContent: 'center' }}>
              <Flex vertical align="center" gap={6} style={{ width: "100%", maxWidth: size }}>
                <Typography.Text strong>{rightLabel ?? 'Document photo'}</Typography.Text>
                <MediaImage media={right} width="100%" height={size * 1.2} caption={false} fit="contain" />
              </Flex>
            </Col>
          )}
        </Row>
      </Image.PreviewGroup>
      <div style={{ marginTop: 20, maxWidth: 560, marginInline: 'auto' }}>
        {hasFaceMatch ? (
          <SimilarityBand value={similarity} thresholds={thresholds} size={large ? 'large' : 'small'} />
        ) : dup ? (
          <Typography.Text>
            Duplicate search: similarity <span className="tabular">{formatSimilarity(dup.score)}</span> with the face already registered to{' '}
            {dup.partyName ?? `person #${dup.partyId}`}
            {dup.threshold && <Typography.Text type="secondary"> (same face from {dup.threshold})</Typography.Text>}.
          </Typography.Text>
        ) : selfieOnly ? (
          <Typography.Text type="secondary">This flow has no document: only the selfie liveness is checked.</Typography.Text>
        ) : (
          <Typography.Text type="secondary">This flow has no face matching step.</Typography.Text>
        )}
      </div>
    </Card>
  );
}
