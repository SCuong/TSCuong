import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Badge } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';
import { formatLocalDateTime } from '../shared-b/time';
import { HEADER_PARAMS, JWE_ENCRYPTION, describeAlgorithm } from './lib/algorithms';
import { SEGMENT_LABELS, type Segment, type SegmentName } from './lib/decode';
import type { ClaimsReport, Tone } from './lib/claims';

/** Text colour classes for token parts (theme syntax tokens, so both themes work). */
export const SEGMENT_TEXT: Record<SegmentName, string> = {
  header: 'text-[var(--lk-syn-keyword)]',
  payload: 'text-[var(--lk-syn-function)]',
  signature: 'text-[var(--lk-syn-property)]',
  encryptedKey: 'text-[var(--lk-syn-type)]',
  iv: 'text-[var(--lk-syn-tag)]',
  ciphertext: 'text-[var(--lk-syn-function)]',
  tag: 'text-[var(--lk-syn-property)]',
};

const JWS_CLASSES = ['cm-jwt-header', 'cm-jwt-payload', 'cm-jwt-signature'];
const JWE_CLASSES = ['cm-jwt-header', 'cm-jwt-key', 'cm-jwt-iv', 'cm-jwt-ciphertext', 'cm-jwt-tag'];

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  if (text.length > 100_000 || /^\s*[{[]/.test(text)) return builder.finish();
  const prefix = /^\s*(?:authorization\s*:\s*)?(?:(?:bearer|jwt|dpop)\s+)?["'`]?/i.exec(text)?.[0].length ?? 0;
  const suffix = /["'`]?[,;]?\s*$/.exec(text)?.[0].length ?? 0;
  const end = Math.max(prefix, text.length - suffix);
  const dots: number[] = [];
  for (let i = prefix; i < end; i++) if (text.charCodeAt(i) === 46) dots.push(i);
  const classes = dots.length === 4 ? JWE_CLASSES : JWS_CLASSES;
  let start = prefix;
  for (let part = 0; part <= dots.length; part++) {
    const stop = part < dots.length ? dots[part] : end;
    if (stop > start) builder.add(start, stop, Decoration.mark({ class: classes[part] ?? 'cm-jwt-extra' }));
    if (part < dots.length) builder.add(stop, stop + 1, Decoration.mark({ class: 'cm-jwt-dot' }));
    start = stop + 1;
  }
  return builder.finish();
}

const jwtColors = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = buildDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const jwtTheme = EditorView.baseTheme({
  '.cm-jwt-header': { color: 'var(--lk-syn-keyword)' },
  '.cm-jwt-payload': { color: 'var(--lk-syn-function)' },
  '.cm-jwt-signature': { color: 'var(--lk-syn-property)' },
  '.cm-jwt-key': { color: 'var(--lk-syn-type)' },
  '.cm-jwt-iv': { color: 'var(--lk-syn-tag)' },
  '.cm-jwt-ciphertext': { color: 'var(--lk-syn-function)' },
  '.cm-jwt-tag': { color: 'var(--lk-syn-property)' },
  '.cm-jwt-extra': { color: 'var(--lk-danger)', textDecoration: 'underline wavy var(--lk-danger)' },
  '.cm-jwt-dot': { color: 'var(--lk-text-primary)', fontWeight: '700' },
});

/** A token is one long line: line numbers add nothing, so the gutter is hidden. */
const noGutter = EditorView.theme({ '.cm-gutters': { display: 'none' } });

/** CodeMirror extensions that colour JWT/JWE parts. A stable array, as EditorPanel requires. */
export const JWT_EDITOR_EXTENSIONS: Extension[] = [jwtColors, jwtTheme, noGutter];

/** Legend of token parts with their sizes. */
export function SegmentLegend({ segments }: { segments: Segment[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {segments.map((s, i) => (
        <li key={i} className="inline-flex items-center gap-1.5 text-[12.5px]">
          <span className={cn('size-2 rounded-full bg-current', SEGMENT_TEXT[s.name])} aria-hidden />
          <span className="text-fg-secondary">{SEGMENT_LABELS[s.name]}</span>
          <span className="text-fg-muted tabular-nums">
            {s.byteLength === null ? `${s.text.length} chars` : `${s.byteLength} B`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export type DetailView = 'explained' | 'json';

export function DetailToggle({ value, onChange, label }: { value: DetailView; onChange: (v: DetailView) => void; label: string }) {
  return (
    <Segmented
      label={label}
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: 'explained', label: 'Explained' },
        { value: 'json', label: 'JSON' },
      ]}
    />
  );
}

const TONE_BADGE: Record<Tone, 'success' | 'danger' | 'warning' | 'neutral'> = {
  success: 'success',
  danger: 'danger',
  warning: 'warning',
  neutral: 'neutral',
};

function compact(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Header parameters with their registered meaning. */
export function HeaderParams({ header }: { header: Record<string, unknown> }) {
  return (
    <dl className="divide-y divide-line">
      {Object.entries(header).map(([key, value]) => {
        const doc = HEADER_PARAMS[key];
        const extra =
          key === 'alg' && typeof value === 'string'
            ? describeAlgorithm(value)
            : key === 'enc' && typeof value === 'string'
              ? JWE_ENCRYPTION[value]
              : undefined;
        return (
          <div key={key} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(120px,170px)_1fr]">
            <dt className="min-w-0">
              <code className="font-mono text-[12.5px] font-semibold text-[var(--lk-syn-property)]">{key}</code>
              {doc && <span className="block text-[12px] text-fg-muted">{doc.name}</span>}
            </dt>
            <dd className="min-w-0 text-[13px]">
              <div className="font-mono text-[12.5px] break-all text-fg">{compact(value)}</div>
              {extra && <p className="text-[12.5px] text-fg-secondary">{extra}</p>}
              {doc && <p className="text-[12px] text-fg-muted">{doc.description}</p>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Claims with explanations, dates and validity badges. */
export function ClaimsList({ report }: { report: ClaimsReport }) {
  if (report.rows.length === 0) return <p className="py-2 text-[13px] text-fg-muted">The claims set is empty.</p>;
  return (
    <dl className="divide-y divide-line">
      {report.rows.map((row) => (
        <div key={row.key} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(120px,170px)_1fr]">
          <dt className="min-w-0">
            <code className="font-mono text-[12.5px] font-semibold break-all text-[var(--lk-syn-property)]">{row.key}</code>
            {row.doc && <span className="block text-[12px] text-fg-muted">{row.doc.name}</span>}
          </dt>
          <dd className="flex min-w-0 flex-col gap-1 text-[13px]">
            <div className="font-mono text-[12.5px] break-all text-fg">{row.display}</div>
            {row.date && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-secondary">
                <span>{formatLocalDateTime(row.date.seconds * 1000)}</span>
                <span className="font-mono text-[12px] text-fg-muted">{row.date.iso}</span>
              </div>
            )}
            {row.status && (
              <span>
                <Badge tone={TONE_BADGE[row.status.tone]}>{row.status.text}</Badge>
              </span>
            )}
            {row.problem && <p className="text-[12.5px] text-warning">{row.problem}</p>}
            {row.doc && row.registered && <p className="text-[12px] text-fg-muted">{row.doc.description}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
