import { App as AntApp, ConfigProvider, theme } from 'antd';
import enGB from 'antd/locale/en_GB';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PALETTE } from '../lib/colors';
import { ThemeModeContext, type ThemeMode } from './useThemeMode';

const KEY = 'camtech.portal.theme';

function initialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const FONT = "'Manrope Variable', Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Arabic', sans-serif";
const CODE_FONT = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace";

/** Light/dark theme built on the noqodi design tokens, remembered per browser. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
  }, [mode]);
  const value = useMemo(() => ({ mode, toggle: () => setMode((m) => (m === 'light' ? 'dark' : 'light')) }), [mode]);
  const dark = mode === 'dark';
  const p = dark ? PALETTE.dark : PALETTE.light;
  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider
        locale={enGB}
        theme={{
          algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: p.primary,
            colorInfo: p.primary,
            colorLink: p.primary,
            colorSuccess: p.success,
            colorWarning: p.warning,
            colorError: p.error,
            colorText: p.text,
            colorTextHeading: p.heading,
            colorTextSecondary: p.textSecondary,
            colorTextTertiary: p.textTertiary,
            colorBgLayout: p.page,
            colorBgContainer: p.card,
            colorBorder: p.border,
            colorBorderSecondary: p.borderSubtle,
            fontFamily: FONT,
            fontFamilyCode: CODE_FONT,
            borderRadius: 8,
            borderRadiusLG: 14,
            controlHeight: 36,
          },
          components: {
            Layout: { headerPadding: '0 24px', headerBg: p.card, siderBg: p.sider, bodyBg: p.page },
            Menu: {
              itemBg: 'transparent',
              itemColor: p.textSecondary,
              itemHoverBg: p.subtle,
              itemSelectedBg: p.selected,
              itemSelectedColor: p.selectedText,
              itemBorderRadius: 8,
              itemHeight: 40,
              groupTitleFontSize: 11,
              groupTitleColor: p.textTertiary,
            },
            Card: { headerFontSize: 16, headerHeight: 56, paddingLG: 24 },
            Table: {
              headerBg: p.subtle,
              headerColor: p.textSecondary,
              headerSplitColor: 'transparent',
              rowHoverBg: p.rowHover,
              cellPaddingBlock: 14,
              cellPaddingInline: 16,
            },
            Button: { fontWeight: 700, primaryShadow: 'none', defaultShadow: 'none', borderRadius: 6 },
            Tag: { defaultBg: p.subtle },
            Statistic: { contentFontSize: 30 },
            Descriptions: { labelColor: p.textSecondary },
          },
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}
