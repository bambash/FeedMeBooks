export const colors = {
  bg: '#0A0A0F',
  surface: '#16161E',
  surfaceHigh: '#1E1E2A',
  border: '#2A2A3A',
  primary: '#7C3AED',
  primaryLight: '#9D6FF8',
  primaryDim: '#3D1C7A',
  accent: '#F59E0B',
  text: '#E8E8F0',
  textMuted: '#6B6B8A',
  textFaint: '#3A3A52',
  success: '#10B981',
  error: '#EF4444',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 12,
  lg: 18,
  full: 999,
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: '700' as const },
  h3: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  small: { fontSize: 13, fontWeight: '400' as const },
  tiny: { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.5 },
} as const;
