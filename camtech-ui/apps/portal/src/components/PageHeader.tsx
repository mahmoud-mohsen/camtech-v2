import { RightOutlined } from '@ant-design/icons';
import { Flex, Typography } from 'antd';
import { Fragment, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';

interface Crumb {
  label: ReactNode;
  to?: string;
}

interface Props {
  title: ReactNode;
  /** Browser tab title; defaults to `title` when it is a string. */
  documentTitle?: string;
  /** One or two sentences: what this page is for. */
  help?: ReactNode;
  extra?: ReactNode;
  /** Shows a breadcrumb back to this path (or history back when true). */
  back?: string | true;
  /** Label for the back crumb; defaults to "Back". */
  backLabel?: ReactNode;
  /** Full breadcrumb trail; takes precedence over `back`. */
  crumbs?: Crumb[];
  tags?: ReactNode;
  /** Leading visual, e.g. an avatar. */
  avatar?: ReactNode;
}

export function PageHeader({ title, documentTitle, help, extra, back, backLabel = 'Back', crumbs, tags, avatar }: Props) {
  const navigate = useNavigate();
  useDocumentTitle(documentTitle ?? (typeof title === 'string' ? title : null));
  const trail: Crumb[] | null = crumbs ?? (back ? [{ label: backLabel, to: back === true ? undefined : back }] : null);
  return (
    <Flex vertical gap={12} style={{ marginBottom: 24 }}>
      {trail && (
        <nav aria-label="Breadcrumb">
          <Flex align="center" gap={8} wrap style={{ fontSize: 14, fontWeight: 600 }}>
            {trail.map((c, i) => (
              <Fragment key={i}>
                {c.to ? (
                  <Link to={c.to}>{c.label}</Link>
                ) : back === true && i === 0 && !crumbs ? (
                  <Typography.Link onClick={() => navigate(-1)}>{c.label}</Typography.Link>
                ) : (
                  <span style={{ color: 'var(--ct-text-secondary)' }}>{c.label}</span>
                )}
                {i < trail.length - 1 && <RightOutlined style={{ fontSize: 10, color: 'var(--ct-text-tertiary)' }} />}
              </Fragment>
            ))}
          </Flex>
        </nav>
      )}
      <Flex justify="space-between" align="center" gap={16} wrap>
        <Flex gap={16} align="center" style={{ minWidth: 0, flex: '1 1 320px' }}>
          {avatar}
          <div style={{ minWidth: 0 }}>
            <Flex align="center" gap={12} wrap>
              <Typography.Title level={2} style={{ margin: 0, fontSize: 28, lineHeight: '36px', fontWeight: 800, letterSpacing: '-0.02em' }}>
                {title}
              </Typography.Title>
              {tags}
            </Flex>
            {help && (
              <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0', maxWidth: 820, fontSize: 15 }}>
                {help}
              </Typography.Paragraph>
            )}
          </div>
        </Flex>
        {extra && (
          <Flex gap={8} wrap>
            {extra}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
