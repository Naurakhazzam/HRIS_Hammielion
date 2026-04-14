// ============================================================
// HRIS HAMMIELION — Theme Constants
// Sync with globals.css CSS Variables
// ============================================================

export const C = {
  bg:           '#F1F5F9',
  surface:      '#FFFFFF',
  surface2:     '#F8FAFC',
  sidebar:      '#FFFFFF',
  border:       '#E2E8F0',
  border2:      '#CBD5E1',

  primary:      '#0D9488',
  primaryHover: '#0F766E',
  primaryLight: '#CCFBF1',
  primaryDim:   '#5EEAD4',

  text:         '#0F172A',
  textSub:      '#64748B',
  textMuted:    '#94A3B8',
  textInvert:   '#FFFFFF',

  success:      '#16A34A',
  successLight: '#DCFCE7',
  warning:      '#D97706',
  warningLight: '#FEF3C7',
  danger:       '#DC2626',
  dangerLight:  '#FEE2E2',
  info:         '#2563EB',
  infoLight:    '#DBEAFE',
} as const;

export type ColorKey = keyof typeof C;
