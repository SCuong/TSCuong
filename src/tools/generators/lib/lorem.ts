/** Lorem ipsum text generation (plain text or HTML). */

export const LOREM_START = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';
const START_WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];

export const LOREM_WORDS = [
  'a', 'ac', 'accumsan', 'ad', 'adipiscing', 'aenean', 'aliquam', 'aliquet', 'amet', 'ante', 'aptent', 'arcu', 'at',
  'auctor', 'augue', 'bibendum', 'blandit', 'class', 'commodo', 'condimentum', 'congue', 'consectetur', 'consequat',
  'conubia', 'convallis', 'cras', 'cubilia', 'curabitur', 'curae', 'cursus', 'dapibus', 'diam', 'dictum', 'dictumst',
  'dignissim', 'dis', 'dolor', 'donec', 'dui', 'duis', 'efficitur', 'egestas', 'eget', 'eleifend', 'elementum', 'elit',
  'enim', 'erat', 'eros', 'est', 'et', 'etiam', 'eu', 'euismod', 'ex', 'facilisi', 'facilisis', 'fames', 'faucibus',
  'felis', 'fermentum', 'feugiat', 'finibus', 'fringilla', 'fusce', 'gravida', 'habitant', 'habitasse', 'hac',
  'hendrerit', 'himenaeos', 'iaculis', 'id', 'imperdiet', 'in', 'inceptos', 'integer', 'interdum', 'ipsum', 'justo',
  'lacinia', 'lacus', 'laoreet', 'lectus', 'leo', 'libero', 'ligula', 'litora', 'lobortis', 'lorem', 'luctus',
  'maecenas', 'magna', 'magnis', 'malesuada', 'massa', 'mattis', 'mauris', 'maximus', 'metus', 'mi', 'molestie',
  'mollis', 'montes', 'morbi', 'mus', 'nam', 'nascetur', 'natoque', 'nec', 'neque', 'netus', 'nibh', 'nisi', 'nisl',
  'non', 'nostra', 'nulla', 'nullam', 'nunc', 'odio', 'orci', 'ornare', 'parturient', 'pellentesque', 'penatibus',
  'per', 'pharetra', 'phasellus', 'placerat', 'platea', 'porta', 'porttitor', 'posuere', 'potenti', 'praesent',
  'pretium', 'primis', 'proin', 'pulvinar', 'purus', 'quam', 'quis', 'quisque', 'rhoncus', 'ridiculus', 'risus',
  'rutrum', 'sagittis', 'sapien', 'scelerisque', 'sed', 'sem', 'semper', 'senectus', 'sit', 'sociosqu', 'sodales',
  'sollicitudin', 'suscipit', 'suspendisse', 'taciti', 'tellus', 'tempor', 'tempus', 'tincidunt', 'torquent',
  'tortor', 'tristique', 'turpis', 'ullamcorper', 'ultrices', 'ultricies', 'urna', 'ut', 'varius', 'vehicula', 'vel',
  'velit', 'venenatis', 'vestibulum', 'vitae', 'vivamus', 'viverra', 'volutpat', 'vulputate',
];

export type LoremUnit = 'paragraphs' | 'sentences' | 'words' | 'list';

export interface LoremOptions {
  unit: LoremUnit;
  count: number;
  startWithLorem: boolean;
  html: boolean;
}

export const LOREM_LIMITS: Record<LoremUnit, number> = { paragraphs: 100, sentences: 1000, words: 10000, list: 500 };

type Rand = () => number;

function int(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function pickWord(rand: Rand, prev?: string): string {
  let w = LOREM_WORDS[Math.floor(rand() * LOREM_WORDS.length)];
  if (w === prev) w = LOREM_WORDS[(LOREM_WORDS.indexOf(w) + 1) % LOREM_WORDS.length];
  return w;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function words(rand: Rand, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(pickWord(rand, out[i - 1]));
  return out;
}

/** One sentence of `min`–`max` words with an occasional comma. */
function sentence(rand: Rand, min = 6, max = 15, lead?: string[]): string {
  const n = int(rand, min, max);
  const list = lead ? [...lead, ...words(rand, Math.max(0, n - lead.length))] : words(rand, n);
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) {
    let w = list[i];
    const commaOk = i >= 2 && i < list.length - 2 && !(lead && i < lead.length);
    if (commaOk && rand() < 0.1) w += ',';
    parts.push(w);
  }
  if (lead && lead.length === START_WORDS.length && parts.length > 5) parts[4] = 'amet,';
  return `${capitalize(parts.join(' '))}.`;
}

function paragraph(rand: Rand, first: boolean): string {
  const count = int(rand, 4, 7);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(sentence(rand, 6, 15, first && i === 0 ? START_WORDS : undefined));
  return out.join(' ');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function generateLorem(options: LoremOptions, rand: Rand = Math.random): string {
  const count = Math.max(1, Math.min(LOREM_LIMITS[options.unit], Math.floor(options.count) || 1));
  const { startWithLorem, html } = options;

  if (options.unit === 'words') {
    const list = words(rand, count);
    if (startWithLorem) for (let i = 0; i < Math.min(count, START_WORDS.length); i++) list[i] = START_WORDS[i];
    const text = `${capitalize(list.join(' '))}.`;
    return html ? `<p>${escapeHtml(text)}</p>` : text;
  }

  if (options.unit === 'sentences') {
    const list: string[] = [];
    for (let i = 0; i < count; i++) list.push(sentence(rand, 6, 15, startWithLorem && i === 0 ? START_WORDS : undefined));
    const text = list.join(' ');
    return html ? `<p>${escapeHtml(text)}</p>` : text;
  }

  if (options.unit === 'list') {
    const items: string[] = [];
    for (let i = 0; i < count; i++) {
      if (startWithLorem && i === 0) items.push(`${LOREM_START}.`);
      else items.push(sentence(rand, 3, 8));
    }
    return html ? `<ul>\n${items.map((t) => `  <li>${escapeHtml(t)}</li>`).join('\n')}\n</ul>` : items.map((t) => `- ${t}`).join('\n');
  }

  const paras: string[] = [];
  for (let i = 0; i < count; i++) paras.push(paragraph(rand, startWithLorem && i === 0));
  return html ? paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n') : paras.join('\n\n');
}

export function countWords(text: string): number {
  const plain = text.replace(/<[^>]+>/g, ' ');
  const m = plain.match(/[A-Za-z]+/g);
  return m ? m.length : 0;
}
