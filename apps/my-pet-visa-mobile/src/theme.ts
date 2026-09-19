/**
 * Brand tokens for My Pet Visa (mypetviza.com).
 *
 * Every color the app uses lives here so the palette can be matched to the
 * website in one place. Swap the hex values below to the site's exact brand
 * colors and every screen updates.
 */
export const colors = {
  // Brand
  primary: '#0F4C5C', // deep teal - headers, primary buttons
  primaryDark: '#0A3641',
  primaryLight: '#E3F1F4', // tinted backgrounds, selected states
  accent: '#F4A259', // warm amber - highlights, progress
  accentLight: '#FDF0E1',

  // Neutrals
  background: '#F7F9FA',
  surface: '#FFFFFF',
  border: '#D9E2E6',
  text: '#15242B',
  textMuted: '#5B6B73',
  placeholder: '#93A1A8',

  // Status
  success: '#2E8B57',
  successLight: '#E4F4EA',
  warning: '#C77700',
  warningLight: '#FFF3DF',
  danger: '#C8392B',
  dangerLight: '#FBE7E4',
  neutralChip: '#EEF2F4',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 20, fontWeight: '700' as const, color: colors.text },
  subheading: { fontSize: 16, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 16, color: colors.text, lineHeight: 22 },
  small: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '600' as const, color: colors.text },
} as const;

/** Minimum tap target for older / less tech-comfortable clients. */
export const TAP_TARGET = 48;
