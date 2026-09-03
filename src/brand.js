// ─────────────────────────────────────────────────────────────────────────────
// SWEETBYTE BRAND — single source of truth for every brand colour in Studio.
//
// This is the ONLY file that should ever contain a brand hex value. Both the
// React front end and the Node back end import from here, so changing a colour
// is a one-line edit in one file rather than a hunt through twenty-odd files.
//
// Values are taken directly from the Sweetbyte logo artwork:
//   #0F1D3F  deep navy   — the wordmark, the dominant brand colour
//   #12295A  navy mid    — the outer ring of the mark
//   #135AA0  blue        — the small floating circle
//   #1EA4C9  cyan        — the spiral, and the headings on sweetbyte.co.uk
//   #1791C0  cyan deep   — the inner spiral
//
// The ramp below runs light → dark and replaces the old green ramp stop for
// stop, so every place that used a green now has a direct equivalent:
//
//   old #E1F5EE (palest tint)   → SB.tint
//   old #9FE1CB (light)         → SB.light
//   old #5DCAA5 (mid-light)     → SB.midLight
//   old #1D9E75 (primary green) → SB.primary
//   old #0F6E56 (strong)        → SB.strong
//   old #085041 (dark text)     → SB.dark
//   old #04342C (darkest)       → SB.darkest
//
// USAGE NOTE — status colours. Green previously did double duty: brand colour
// AND the universal "this worked" signal (Deployed / Active / Sent badges).
// Green has been removed entirely by operator decision (2026-09-02), so those
// badges now use SB.tint as a pale background with SB.dark text, while buttons
// and other actions use SOLID SB.primary. The difference between a pale tint
// and a solid fill is what keeps "finished" visually distinct from "clickable".
// If you ever add a new status badge, follow that rule.
// ─────────────────────────────────────────────────────────────────────────────

export const SB = {
  // ── Core ramp (light → dark) ──────────────────────────────────────────────
  tint:      '#E4F4FA',  // palest wash — badge and banner backgrounds
  light:     '#A9DEF0',  // light accents, borders on dark surfaces, sidebar text
  midLight:  '#5CC3E0',  // hover states, secondary accents
  primary:   '#1EA4C9',  // THE brand colour — buttons, active nav, progress bars
  strong:    '#135AA0',  // links, strong text on light backgrounds
  dark:      '#0F2E5C',  // text sitting on a tint background
  darkest:   '#0F1D3F',  // sidebar background, headings, the wordmark navy

  // ── Named aliases (read better at the call site) ──────────────────────────
  navy:      '#0F1D3F',
  navyMid:   '#12295A',
  blue:      '#135AA0',
  cyan:      '#1EA4C9',
  cyanDeep:  '#1791C0',

  // ── Surfaces ──────────────────────────────────────────────────────────────
  sidebarBg:       '#0F1D3F',
  sidebarHover:    '#12295A',
  sidebarText:     '#B9CEDF',
  sidebarHeading:  '#5E82A8',

  // ── Text that sits ON the primary colour ──────────────────────────────────
  // The cyan is light enough that navy reads better on it than white does.
  onPrimary: '#0F1D3F',
};

// The default colour stamped on a newly created customer record.
export const DEFAULT_CLIENT_COLOR = SB.primary;

// Brand names used in page titles, portal copy and outgoing email.
export const BRAND_NAME = 'Sweetbyte';
export const BRAND_PRODUCT = 'Sweetbyte Studio';

// ─────────────────────────────────────────────────────────────────────────────
// applyBrandCssVars()
//
// Writes every value above onto the document root as CSS custom properties, so
// plain stylesheets (index.css) and any future CSS can use var(--sb-primary)
// without the values being duplicated anywhere. Called once from main.jsx.
//
// Front-end only — guarded so importing this file on the server is harmless.
// ─────────────────────────────────────────────────────────────────────────────
export function applyBrandCssVars() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(SB)) {
    const name = '--sb-' + key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    root.style.setProperty(name, value);
  }
}

export default SB;
