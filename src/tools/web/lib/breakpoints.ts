export interface Breakpoint {
  name: string;
  /** Minimum width in px (inclusive). */
  min: number;
  /** Exclusive upper bound in px, or null for no upper bound. */
  max: number | null;
  note?: string;
}

export interface Framework {
  id: string;
  name: string;
  approach: string;
  breakpoints: Breakpoint[];
}

export const FRAMEWORKS: Framework[] = [
  {
    id: 'tailwind',
    name: 'Tailwind CSS v4',
    approach: 'Mobile-first min-width variants, defined in rem (40rem = 640px at 16px root).',
    breakpoints: [
      { name: '(base)', min: 0, max: 640 },
      { name: 'sm', min: 640, max: 768, note: '40rem' },
      { name: 'md', min: 768, max: 1024, note: '48rem' },
      { name: 'lg', min: 1024, max: 1280, note: '64rem' },
      { name: 'xl', min: 1280, max: 1536, note: '80rem' },
      { name: '2xl', min: 1536, max: null, note: '96rem' },
    ],
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap 5',
    approach: 'Mobile-first min-width media queries; max-width queries subtract 0.02px.',
    breakpoints: [
      { name: 'xs', min: 0, max: 576 },
      { name: 'sm', min: 576, max: 768 },
      { name: 'md', min: 768, max: 992 },
      { name: 'lg', min: 992, max: 1200 },
      { name: 'xl', min: 1200, max: 1400 },
      { name: 'xxl', min: 1400, max: null },
    ],
  },
  {
    id: 'material',
    name: 'Material Design 3',
    approach: 'Window size classes by available width, used to pick layouts (navigation bar, rail or drawer).',
    breakpoints: [
      { name: 'Compact', min: 0, max: 600, note: 'Phones in portrait' },
      { name: 'Medium', min: 600, max: 840, note: 'Tablets in portrait, foldables' },
      { name: 'Expanded', min: 840, max: 1200, note: 'Tablets in landscape' },
      { name: 'Large', min: 1200, max: 1600, note: 'Desktops' },
      { name: 'Extra-large', min: 1600, max: null, note: 'Large desktops' },
    ],
  },
  {
    id: 'foundation',
    name: 'Foundation 6',
    approach: 'Mobile-first; the default $breakpoints map. Media queries are written in em (medium = 40em).',
    breakpoints: [
      { name: 'small', min: 0, max: 640 },
      { name: 'medium', min: 640, max: 1024, note: '40em' },
      { name: 'large', min: 1024, max: 1200, note: '64em' },
      { name: 'xlarge', min: 1200, max: 1440, note: '75em' },
      { name: 'xxlarge', min: 1440, max: null, note: '90em' },
    ],
  },
];

export interface Device {
  name: string;
  kind: 'Phone' | 'Tablet' | 'Laptop' | 'Desktop';
  width: number;
  height: number;
}

/** CSS viewport sizes (portrait for phones and tablets). */
export const DEVICES: Device[] = [
  { name: 'Galaxy S23 / S24', kind: 'Phone', width: 360, height: 780 },
  { name: 'iPhone SE (2nd / 3rd gen)', kind: 'Phone', width: 375, height: 667 },
  { name: 'iPhone 13 / 14', kind: 'Phone', width: 390, height: 844 },
  { name: 'iPhone 15 / 16', kind: 'Phone', width: 393, height: 852 },
  { name: 'iPhone 16 Pro', kind: 'Phone', width: 402, height: 874 },
  { name: 'Pixel 7 / 8', kind: 'Phone', width: 412, height: 915 },
  { name: 'iPhone 15 Pro Max / 16 Plus', kind: 'Phone', width: 430, height: 932 },
  { name: 'iPhone 16 Pro Max', kind: 'Phone', width: 440, height: 956 },
  { name: 'iPad mini (6th gen)', kind: 'Tablet', width: 744, height: 1133 },
  { name: 'iPad (10th gen)', kind: 'Tablet', width: 820, height: 1180 },
  { name: 'iPad Pro 11"', kind: 'Tablet', width: 834, height: 1194 },
  { name: 'iPad Pro 12.9"', kind: 'Tablet', width: 1024, height: 1366 },
  { name: 'Common laptop (1366 × 768)', kind: 'Laptop', width: 1366, height: 768 },
  { name: 'MacBook Air 13" (default scaling)', kind: 'Laptop', width: 1470, height: 956 },
  { name: 'Laptop at 125% scaling (1536 × 864)', kind: 'Laptop', width: 1536, height: 864 },
  { name: 'Full HD monitor', kind: 'Desktop', width: 1920, height: 1080 },
  { name: 'QHD monitor', kind: 'Desktop', width: 2560, height: 1440 },
];

export function activeBreakpoint(framework: Framework, width: number): Breakpoint {
  return framework.breakpoints.find((b) => width >= b.min && (b.max === null || width < b.max)) ?? framework.breakpoints[0];
}

export interface MediaQueryOptions {
  mode: 'min' | 'max' | 'between';
  min: number;
  max: number;
  unit: 'px' | 'em';
  syntax: 'classic' | 'range';
  orientation: 'any' | 'portrait' | 'landscape';
  colorScheme: 'any' | 'dark' | 'light';
  reducedMotion: boolean;
  hover: boolean;
}

const len = (px: number, unit: 'px' | 'em') => {
  const v = unit === 'em' ? px / 16 : px;
  return `${Number(v.toFixed(unit === 'em' ? 4 : 2))}${unit}`;
};

/**
 * Builds a media query. Classic max-width queries subtract 0.02px so that
 * `max-width` and a matching `min-width` never both apply (the Bootstrap convention);
 * range syntax uses `<` and needs no offset.
 */
export function buildMediaQuery(o: MediaQueryOptions): string {
  const parts: string[] = [];
  const lo = Math.max(0, Math.min(o.min, o.max));
  const hi = Math.max(o.min, o.max);
  if (o.syntax === 'range') {
    if (o.mode === 'min') parts.push(`(width >= ${len(o.min, o.unit)})`);
    else if (o.mode === 'max') parts.push(`(width < ${len(o.max, o.unit)})`);
    else parts.push(`(${len(lo, o.unit)} <= width < ${len(hi, o.unit)})`);
  } else {
    if (o.mode === 'min' || o.mode === 'between') parts.push(`(min-width: ${len(o.mode === 'min' ? o.min : lo, o.unit)})`);
    if (o.mode === 'max' || o.mode === 'between') parts.push(`(max-width: ${len((o.mode === 'max' ? o.max : hi) - 0.02, o.unit)})`);
  }
  if (o.orientation !== 'any') parts.push(`(orientation: ${o.orientation})`);
  if (o.colorScheme !== 'any') parts.push(`(prefers-color-scheme: ${o.colorScheme})`);
  if (o.reducedMotion) parts.push('(prefers-reduced-motion: reduce)');
  if (o.hover) parts.push('(hover: hover) and (pointer: fine)');
  return `@media ${parts.join(' and ')} {\n  /* your styles */\n}`;
}

const trim = (n: number) => String(Number(n.toFixed(5)));

/**
 * The media query condition a framework itself uses for a breakpoint:
 * `up` applies from this breakpoint upwards, `only` applies to this breakpoint's range.
 * Returns null for the base range, which needs no media query in mobile-first CSS.
 */
export function frameworkQuery(framework: Framework, bp: Breakpoint, kind: 'up' | 'only'): string | null {
  const hasMin = bp.min > 0;
  const hasMax = kind === 'only' && bp.max !== null;
  if (!hasMin && !hasMax) return null;
  switch (framework.id) {
    case 'tailwind': {
      const rem = (px: number) => `${trim(px / 16)}rem`;
      if (hasMin && hasMax) return `@media (${rem(bp.min)} <= width < ${rem(bp.max!)})`;
      return hasMin ? `@media (width >= ${rem(bp.min)})` : `@media (width < ${rem(bp.max!)})`;
    }
    case 'foundation': {
      // Foundation subtracts 1/800em (0.02px) from upper bounds.
      const em = (px: number) => `${trim(px / 16)}em`;
      const max = (px: number) => `${trim(px / 16 - 0.00125)}em`;
      const parts = [hasMin ? `(min-width: ${em(bp.min)})` : '', hasMax ? `(max-width: ${max(bp.max!)})` : ''].filter(Boolean);
      return `@media print, screen and ${parts.join(' and ')}`;
    }
    default: {
      const parts = [hasMin ? `(min-width: ${bp.min}px)` : '', hasMax ? `(max-width: ${trim(bp.max! - 0.02)}px)` : ''].filter(Boolean);
      return `@media ${parts.join(' and ')}`;
    }
  }
}
