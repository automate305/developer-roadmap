/**
 * Brand tokens for PetViza (mypetviza.com).
 *
 * Values come straight from the website's CSS variables (HSL converted to hex)
 * and the logo, so the app and the site read as one product. Every screen
 * pulls from this file; nothing else hard-codes a color or font.
 *
 *   site --primary      215 57% 15%  -> #10233C  deep navy (text, buttons)
 *   site --secondary    214 48% 86%  -> #CAD9EC  hero light blue
 *   site --muted        214 32% 95%  -> #EEF2F6  soft panels
 *   site --muted-fg     215 21% 42%  -> #556782  secondary text
 *   site --border       214 28% 84%  -> #CBD5E2  borders, inputs
 *   site --accent         2 76% 76%  -> #F09693  coral highlight
 *   site --destructive    4 68% 47%  -> #C93126  errors
 *   logo "Viza" blue                 -> #1070B0  bright brand blue
 *   logo navy                        -> #003870
 */
export const colors = {
  // Brand
  primary: '#10233C', // deep navy - headings, primary buttons
  primaryDark: '#0A1729',
  primaryLight: '#CAD9EC', // site hero / secondary - selected states
  brandBlue: '#1070B0', // logo blue - progress, links, small highlights
  brandBlueLight: '#E3EFF8',
  accent: '#F09693', // coral - warm highlight
  accentLight: '#FCE8E7',

  // Neutrals
  background: '#F6F8FB', // a touch cooler than white so cards lift
  surface: '#FFFFFF',
  muted: '#EEF2F6',
  border: '#CBD5E2',
  text: '#10233C',
  textMuted: '#556782',
  placeholder: '#8A9AB0',

  // Status
  success: '#2E7D5B',
  successLight: '#E3F2EA',
  warning: '#9A5B00',
  warningLight: '#FCE8E7', // coral tint, matches the brand accent
  danger: '#C93126',
  dangerLight: '#FBE5E3',
  neutralChip: '#EEF2F6',
} as const;

/** Font families - loaded in App.tsx from @expo-google-fonts. */
export const fonts = {
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemiBold: 'DMSans_600SemiBold',
  sansBold: 'DMSans_700Bold',
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** The site uses a tight .35rem radius. Slightly larger on touch targets. */
export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 26, fontFamily: fonts.displayBold, color: colors.text, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontFamily: fonts.display, color: colors.text },
  subheading: { fontSize: 16, fontFamily: fonts.sansBold, color: colors.text },
  body: { fontSize: 16, fontFamily: fonts.sans, color: colors.text, lineHeight: 22 },
  small: { fontSize: 14, fontFamily: fonts.sans, color: colors.textMuted, lineHeight: 20 },
  label: { fontSize: 14, fontFamily: fonts.sansSemiBold, color: colors.text },
} as const;

/** Minimum tap target for older / less tech-comfortable clients. */
export const TAP_TARGET = 48;
