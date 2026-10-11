// Small inline icons (no icon font, no network). Decorative by default (aria-hidden).
import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IconClose = (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const IconAlert = (p: IconProps) => <Svg {...p}><path d="M12 8v5M12 16.5v.5" /><path d="M10.3 3.9L2.4 17.6A2 2 0 004.1 20.6h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></Svg>;
export const IconInfo = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></Svg>;
export const IconClock = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconCamera = (p: IconProps) => <Svg {...p}><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.5" /></Svg>;
export const IconFace = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9 10v.5M15 10v.5M8.5 15a4.5 4.5 0 007 0" /></Svg>;
export const IconIdCard = (p: IconProps) => <Svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="11" r="2" /><path d="M6 15.5c.5-1.3 1.4-2 2.5-2s2 .7 2.5 2M14 10h4M14 13h4" /></Svg>;
export const IconPassport = (p: IconProps) => <Svg {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M9 16h6" /></Svg>;
export const IconDocument = (p: IconProps) => <Svg {...p}><path d="M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Svg>;
export const IconSun = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const IconGlasses = (p: IconProps) => <Svg {...p}><circle cx="6.5" cy="14" r="3.5" /><circle cx="17.5" cy="14" r="3.5" /><path d="M10 14h4M3 13l2-6M21 13l-2-6" /></Svg>;
export const IconPhone = (p: IconProps) => <Svg {...p}><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></Svg>;
export const IconFlash = (p: IconProps) => <Svg {...p}><path d="M13 2L5 13h6l-1 9 8-11h-6l1-9z" /></Svg>;
export const IconUpload = (p: IconProps) => <Svg {...p}><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></Svg>;
export const IconSwitch = (p: IconProps) => <Svg {...p}><path d="M4 8h13l-3-3M20 16H7l3 3" /></Svg>;
export const IconRefresh = (p: IconProps) => <Svg {...p}><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></Svg>;
export const IconShield = (p: IconProps) => <Svg {...p}><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></Svg>;
export const IconLock = (p: IconProps) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></Svg>;
export const IconPlus = (p: IconProps) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconEdit = (p: IconProps) => <Svg {...p}><path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></Svg>;
export const IconSearch = (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></Svg>;
export const IconChevron =(p: IconProps) => <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>;
export const IconWifiOff = (p: IconProps) => <Svg {...p}><path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015.5-2.8M19 12.5a10 10 0 00-2.4-1.7M2 8.8a15 15 0 014.4-2.7M22 8.8A15 15 0 0011.5 5M12 20h.01" /></Svg>;
