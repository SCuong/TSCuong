import {
  Braces,
  Calculator,
  CalendarClock,
  Code,
  FileText,
  FolderOpen,
  GitBranch,
  Image,
  LayoutGrid,
  Network,
  Palette,
  QrCode,
  ShieldCheck,
  Sparkles,
  Table2,
  Type,
  Binary,
} from 'lucide-react';
import type { CategoryDefinition, CategoryId } from './types';

/** Display order on the home page and in navigation. */
export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'workspace',
    name: 'Workspaces',
    description: 'Full apps for notes, snippets, diagrams, databases, APIs and local file search.',
    icon: LayoutGrid,
    hue: 217,
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: 'Merge, split, organize, compress, watermark and OCR PDFs on your device.',
    icon: FileText,
    hue: 0,
  },
  {
    id: 'image',
    name: 'Images',
    description: 'Compress, convert, resize, crop and inspect images in batches.',
    icon: Image,
    hue: 270,
  },
  {
    id: 'json',
    name: 'JSON',
    description: 'Format, validate, explore, query, diff and convert JSON.',
    icon: Braces,
    hue: 38,
  },
  {
    id: 'text',
    name: 'Text',
    description: 'Clean up, transform, compare and analyze text.',
    icon: Type,
    hue: 200,
  },
  {
    id: 'encoding',
    name: 'Encoding',
    description: 'Base64, URL, HTML entities, Unicode escapes and binary encodings.',
    icon: Binary,
    hue: 172,
  },
  {
    id: 'data',
    name: 'Data & Formats',
    description: 'CSV, YAML, XML, TOML, SQL and spreadsheet conversions.',
    icon: Table2,
    hue: 145,
  },
  {
    id: 'web',
    name: 'Web Development',
    description: 'Formatters, minifiers, CSS generators, meta tags and URL tools.',
    icon: Code,
    hue: 190,
  },
  {
    id: 'color',
    name: 'Color & Design',
    description: 'Convert colors, check contrast and build palettes.',
    icon: Palette,
    hue: 330,
  },
  {
    id: 'security',
    name: 'Security & Crypto',
    description: 'Hashes, HMAC, encryption, JWTs, certificates and passwords.',
    icon: ShieldCheck,
    hue: 158,
  },
  {
    id: 'generators',
    name: 'Generators',
    description: 'UUIDs, IDs, placeholder text, random values and mock data.',
    icon: Sparkles,
    hue: 245,
  },
  {
    id: 'datetime',
    name: 'Date & Time',
    description: 'Timestamps, time zones, durations, date math and cron schedules.',
    icon: CalendarClock,
    hue: 25,
  },
  {
    id: 'network',
    name: 'Network & HTTP',
    description: 'HTTP references, URLs, IP subnets, user agents and cURL.',
    icon: Network,
    hue: 185,
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Diffs, patches, commit messages, branch names and Git references.',
    icon: GitBranch,
    hue: 12,
  },
  {
    id: 'qr',
    name: 'QR & Barcodes',
    description: 'Generate and scan QR codes and barcodes.',
    icon: QrCode,
    hue: 225,
  },
  {
    id: 'math',
    name: 'Math & Units',
    description: 'Unit conversion, number bases, percentages and statistics.',
    icon: Calculator,
    hue: 85,
  },
  {
    id: 'files',
    name: 'Files',
    description: 'Inspect, hash, rename, archive and re-encode local files.',
    icon: FolderOpen,
    hue: 48,
  },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): CategoryDefinition {
  const category = byId.get(id);
  if (!category) throw new Error(`Unknown category: ${id}`);
  return category;
}

export function isCategoryId(value: string): value is CategoryId {
  return byId.has(value as CategoryId);
}
