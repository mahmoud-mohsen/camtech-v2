import { ClockCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Col, Descriptions, Flex, Row, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { CodeBlock } from '../../components/CodeBlock';
import { CopyButton } from '../../components/CopyButton';
import { DecisionTag } from '../../components/Tags';
import { JWKS_URL } from '../../env';
import { formatCountdown, formatDateTime } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { decodeJwt, secondsUntilExpiry } from '../../lib/jwt';
import { flowLabel } from '../../lib/labels';
import { shortKey } from '../../lib/mask';

function Expiry({ exp }: { exp: number }) {
  const now = useNow(1000);
  const left = Math.floor(exp - now / 1000);
  return (
    <Tag icon={<ClockCircleOutlined />} color={left <= 0 ? 'error' : left < 120 ? 'warning' : 'processing'} className="tabular">
      {left <= 0 ? 'Expired' : `Expires in ${formatCountdown(left)}`}
    </Tag>
  );
}

/** Decodes (not verifies) a result token and explains how to verify it on the backend. */
export function JwtDecoder({ token, title }: { token: string; title?: string }) {
  const r = decodeJwt(token);
  if (!r.ok) {
    return (
      <Alert
        type="info"
        showIcon
        title={title ? `${title}: not a JWT` : 'Not a JWT'}
        description={
          <span>
            {r.error}. <Typography.Text code>{shortKey(token, 24, 6)}</Typography.Text>
          </span>
        }
      />
    );
  }
  const { header, payload } = r.jwt;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const left = secondsUntilExpiry(r.jwt);
  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" gap={8} wrap>
        <Flex align="center" gap={8} wrap>
          <SafetyCertificateOutlined />
          <Typography.Text strong>{title ?? 'Result token'}</Typography.Text>
          {str(payload.decision) && <DecisionTag value={str(payload.decision)} />}
          {r.jwt.expiresAt !== null && <Expiry exp={r.jwt.expiresAt} />}
        </Flex>
        <CopyButton text={token} label="Copy token" showLabel type="default" />
      </Flex>
      <Descriptions
        size="small"
        column={{ xs: 1, md: 2 }}
        items={[
          { label: 'Flow', children: str(payload.flow) ? flowLabel(str(payload.flow)) : '—' },
          { label: 'Subject (your user ref)', children: str(payload.sub) ?? '—' },
          { label: 'Session', children: str(payload.sid) ? <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>{str(payload.sid)}</Typography.Text> : '—' },
          { label: 'Decided by', children: str(payload.decidedBy) ?? '—' },
          { label: 'Issued', children: r.jwt.issuedAt ? formatDateTime(new Date(r.jwt.issuedAt * 1000).toISOString()) : '—' },
          { label: 'Expires', children: r.jwt.expiresAt ? formatDateTime(new Date(r.jwt.expiresAt * 1000).toISOString()) : '—' },
        ]}
      />
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={9}>
          <CodeBlock code={JSON.stringify(header, null, 2)} title="header" maxHeight={260} />
        </Col>
        <Col xs={24} lg={15}>
          <CodeBlock code={JSON.stringify(payload, null, 2)} title="claims" maxHeight={260} />
        </Col>
      </Row>
      <Alert
        type={left !== null && left <= 0 ? 'warning' : 'info'}
        showIcon
        title="Decoded here, verified on your backend"
        description={
          <span>
            Anyone can decode a JWT; only the signature proves it came from CamTech. Your backend must verify the RS256 signature with the public keys at{' '}
            <Typography.Text code copyable style={{ fontSize: 12 }}>{JWKS_URL}</Typography.Text> (kid <Typography.Text code>{str(header.kid) ?? '—'}</Typography.Text>), check{' '}
            <Typography.Text code>iss = camtech</Typography.Text>, <Typography.Text code>exp</Typography.Text>, and that <Typography.Text code>sub</Typography.Text> is your user.{' '}
            <Link to="/guide?tab=verify">Code samples</Link>
          </span>
        }
      />
    </Flex>
  );
}
