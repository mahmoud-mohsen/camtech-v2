import { SafetyCertificateFilled } from '@ant-design/icons';
import { BRAND } from '../lib/colors';

/** The console logo: a shield in a rounded brand tile. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: size * 0.28, background: BRAND.primary, color: '#FFFFFF', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size / 2,
      }}
    >
      <SafetyCertificateFilled />
    </span>
  );
}
