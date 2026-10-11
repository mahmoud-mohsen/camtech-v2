import { Col, Flex, Row } from 'antd';
import type { ReactNode } from 'react';

export interface SummaryItem {
  label: ReactNode;
  value: ReactNode;
}

/** The key facts of a record in one row under its title, so the page answers "what is this?" at a glance. */
export function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        marginBottom: 24,
        border: '1px solid var(--ct-border)',
        borderRadius: 14,
        background: 'var(--ct-card)',
        boxShadow: 'var(--ct-shadow-xs)',
        overflow: 'hidden',
      }}
    >
      {items.map((i, n) => (
        <Flex key={n} vertical gap={4} style={{ padding: '14px 18px', minWidth: 0, boxShadow: 'inset 1px 0 0 var(--ct-border-subtle)' }}>
          <span className="ct-meta">{i.label}</span>
          <span style={{ fontWeight: 600, color: 'var(--ct-heading)', minWidth: 0, overflowWrap: 'anywhere' }}>{i.value}</span>
        </Flex>
      ))}
    </div>
  );
}

/**
 * The two columns of every detail page: the record's content (wide) and its facts and actions (narrow).
 * On phones they stack; `sideFirst` puts the narrow column on top when it holds what people come for (e.g. the decision).
 */
export function DetailColumns({ main, side, sideFirst }: { main: ReactNode; side: ReactNode; sideFirst?: boolean }) {
  return (
    <Row gutter={[24, 24]}>
      <Col xs={{ span: 24, order: sideFirst ? 2 : 1 }} xl={{ span: 15, order: 1 }}>
        <Flex vertical gap={24}>
          {main}
        </Flex>
      </Col>
      <Col xs={{ span: 24, order: sideFirst ? 1 : 2 }} xl={{ span: 9, order: 2 }}>
        <Flex vertical gap={24}>
          {side}
        </Flex>
      </Col>
    </Row>
  );
}
