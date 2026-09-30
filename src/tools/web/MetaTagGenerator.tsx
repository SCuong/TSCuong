import { useMemo, useState, type ReactNode } from 'react';
import { Eraser, FlaskConical, ImageOff } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Panel } from '@/components/ui/Panel';
import { Field, Input, Label, Select, Switch, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Segmented } from '@/components/ui/Segmented';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  DEFAULT_META,
  LENGTHS,
  breadcrumbUrl,
  charCount,
  generateMetaTags,
  isLoadableImageUrl,
  isValidColor,
  lengthStatus,
  truncate,
  validateMeta,
  type LengthGuide,
  type MetaInput,
} from './lib/metaTags';

const TOOL = 'meta-tag-generator';

/** "Clear" empties every text field and keeps the switches and choices. */
const EMPTY_TEXT = {
  title: '',
  description: '',
  url: '',
  siteName: '',
  image: '',
  imageAlt: '',
  locale: '',
  twitterSite: '',
  twitterCreator: '',
  themeColor: '',
} satisfies Partial<MetaInput>;

function Counter({ text, guide }: { text: string; guide: LengthGuide }) {
  const status = lengthStatus(text, guide);
  const n = charCount(text.trim());
  const tone = status === 'good' ? 'text-success' : status === 'long' ? 'text-danger' : status === 'short' ? 'text-warning' : 'text-fg-muted';
  const note = status === 'good' ? 'good length' : status === 'long' ? 'likely truncated' : status === 'short' ? 'a bit short' : `aim for ${guide.min}–${guide.max}`;
  return (
    <span className={cn('text-[12px] tabular-nums', tone)} aria-live="polite">
      {n} / {guide.max} · {note}
    </span>
  );
}

function PreviewImage({ src: typed, alt, className }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  // Load only once typing pauses and the URL looks complete: half-typed URLs ("https://im") would
  // otherwise send a request to a different host on every keystroke.
  const src = useDebouncedValue(typed, 600);
  const settled = src === typed;
  const valid = isLoadableImageUrl(src);
  if (!valid || failed === src) {
    const note = !typed.trim() ? 'No image' : !settled ? 'Waiting for you to finish typing…' : valid ? 'Image failed to load' : 'Enter a complete image URL';
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 bg-surface-hover text-fg-muted', className)}>
        <ImageOff size={20} aria-hidden />
        <span className="px-2 text-center text-[11.5px]">{note}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(src)} className={cn('object-cover', className)} />;
}

function SearchPreview({ m }: { m: MetaInput }) {
  const crumb = breadcrumbUrl(m.url);
  const site = m.siteName.trim() || crumb?.host || 'Your site';
  return (
    <div className="rounded-lg border border-line bg-surface-sunken p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised text-[12px] font-semibold text-fg-secondary">
          {Array.from(site)[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] text-fg">{site}</div>
          <div className="truncate text-[12px] text-fg-muted">{crumb ? [crumb.host, ...crumb.path].join(' › ') : 'Add a page URL'}</div>
        </div>
      </div>
      <div className="mt-2 text-[18px] leading-snug text-accent-text">{truncate(m.title, 60) || 'Add a title'}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-fg-secondary">{truncate(m.description, 158) || 'Add a description. Without one, search engines pick a snippet from the page.'}</p>
      {!m.robotsIndex && <p className="mt-2 text-[12px] text-warning">noindex is set: this page will not appear in search results.</p>}
    </div>
  );
}

function SocialPreview({ m }: { m: MetaInput }) {
  const host = breadcrumbUrl(m.url)?.host ?? '';
  const large = m.twitterCard === 'summary_large_image' && m.image.trim() !== '';
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface-sunken', !large && 'flex')}>
      <PreviewImage src={m.image} alt={m.imageAlt} className={large ? 'aspect-[1.91/1] w-full' : 'size-[104px] shrink-0 border-r border-line sm:size-[124px]'} />
      <div className={cn('min-w-0 px-3.5 py-3', large && 'border-t border-line')}>
        <div className="truncate text-[12px] text-fg-muted uppercase">{host || 'example.com'}</div>
        <div className="mt-0.5 line-clamp-2 text-[14.5px] font-semibold text-fg">{truncate(m.title, 90) || 'Add a title'}</div>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-fg-secondary">{truncate(m.description, 200) || 'Add a description'}</p>
      </div>
    </div>
  );
}

function ChatPreview({ m }: { m: MetaInput }) {
  const color = isValidColor(m.themeColor) ? m.themeColor.trim() : undefined;
  return (
    <div className="flex gap-3 rounded-lg bg-surface-sunken p-3">
      <div className="w-1 shrink-0 rounded-full bg-line-strong" style={color ? { background: color } : undefined} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-fg-secondary">{m.siteName.trim() || breadcrumbUrl(m.url)?.host || 'Your site'}</div>
        <div className="mt-0.5 text-[14px] font-semibold text-accent-text">{truncate(m.title, 100) || 'Add a title'}</div>
        <p className="mt-0.5 line-clamp-3 text-[13px] text-fg-secondary">{truncate(m.description, 300)}</p>
        {m.image.trim() && <PreviewImage src={m.image} alt={m.imageAlt} className="mt-2 aspect-[1.91/1] w-full max-w-[360px] rounded-md" />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-[12px] font-semibold tracking-wide text-fg-muted uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

export default function MetaTagGenerator() {
  const [m, setM] = useToolState<MetaInput>(TOOL, 'meta', DEFAULT_META);
  const meta = useMemo(() => ({ ...DEFAULT_META, ...m }), [m]);
  const set = <K extends keyof MetaInput>(key: K) => (value: MetaInput[K]) => setM((prev) => ({ ...DEFAULT_META, ...prev, [key]: value }));
  const [preview, setPreview] = useToolState<'search' | 'social' | 'chat'>(TOOL, 'preview', 'search');

  const html = useMemo(() => generateMetaTags(meta), [meta]);
  const issues = useMemo(() => validateMeta(meta), [meta]);
  const errorFor = (field: keyof MetaInput) => issues.find((i) => i.field === field && i.level === 'error')?.message ?? null;
  const warnings = issues.filter((i) => i.level === 'warning');

  const text = (key: 'url' | 'siteName' | 'image' | 'imageAlt' | 'locale' | 'twitterSite' | 'twitterCreator', label: string, placeholder: string, hint?: string) => (
    <Field label={label} hint={hint} error={errorFor(key)}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={meta[key]}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => set(key)(e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <ToolStack>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Page details"
          actions={
            <>
              <Button size="sm" variant="ghost" icon={FlaskConical} onClick={() => setM(DEFAULT_META)}>
                Load sample
              </Button>
              <Button size="sm" variant="ghost" icon={Eraser} onClick={() => setM({ ...meta, ...EMPTY_TEXT })}>
                Clear
              </Button>
            </>
          }
          bodyClassName="flex flex-col gap-6"
        >
          <Section title="Search">
            <Field label="Title" hint={<Counter text={meta.title} guide={LENGTHS.title} />}>
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} value={meta.title} placeholder="Page title | Brand" onChange={(e) => set('title')(e.target.value)} />
              )}
            </Field>
            <Field label="Description" hint={<Counter text={meta.description} guide={LENGTHS.description} />}>
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  mono={false}
                  rows={4}
                  value={meta.description}
                  placeholder="A one- or two-sentence summary of the page."
                  onChange={(e) => set('description')(e.target.value)}
                />
              )}
            </Field>
            {text('url', 'Page URL', 'https://example.com/page', 'Used for the canonical link and og:url.')}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Switch label="Allow indexing" checked={meta.robotsIndex} onChange={set('robotsIndex')} />
              <Switch label="Follow links" checked={meta.robotsFollow} onChange={set('robotsFollow')} />
              <Switch label="Large image previews" checked={meta.largeImagePreview} onChange={set('largeImagePreview')} disabled={!meta.robotsIndex} />
            </div>
          </Section>

          <Section title="Social">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {text('siteName', 'Site name', 'Brand')}
              <div>
                <Label htmlFor="mt-type">Content type (og:type)</Label>
                <Select id="mt-type" value={meta.ogType} onChange={(e) => set('ogType')(e.target.value as MetaInput['ogType'])}>
                  <option value="website">website</option>
                  <option value="article">article</option>
                  <option value="product">product</option>
                  <option value="profile">profile</option>
                </Select>
              </div>
            </div>
            {text('image', 'Image URL', 'https://example.com/og-image.jpg', 'Absolute URL, ideally 1200 × 630 px. It is only loaded for the previews here.')}
            {text('imageAlt', 'Image description (alt)', 'What the image shows')}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {text('twitterSite', 'X account of the site', '@brand')}
              {text('twitterCreator', 'X account of the author', '@author')}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>X card</Label>
                <Segmented
                  label="X card type"
                  value={meta.twitterCard}
                  onChange={set('twitterCard')}
                  options={[
                    { value: 'summary_large_image', label: 'Large image' },
                    { value: 'summary', label: 'Summary' },
                  ]}
                />
              </div>
              {text('locale', 'Locale', 'en_US')}
            </div>
          </Section>

          <Section title="Browser">
            <Field label="Theme color" error={errorFor('themeColor')} hint="Tints the browser UI on mobile.">
              {({ id, describedBy, invalid }) => (
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label="Pick theme color"
                    value={/^#[0-9a-f]{6}$/i.test(meta.themeColor.trim()) ? meta.themeColor.trim() : '#000000'}
                    onChange={(e) => set('themeColor')(e.target.value)}
                    className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-line-strong bg-surface-sunken p-1"
                  />
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    mono
                    value={meta.themeColor}
                    placeholder="#1f6f50 (optional)"
                    onChange={(e) => set('themeColor')(e.target.value)}
                  />
                </div>
              )}
            </Field>
            <div className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-2">
              <Switch label="charset" checked={meta.includeCharset} onChange={set('includeCharset')} />
              <Switch label="viewport" checked={meta.includeViewport} onChange={set('includeViewport')} />
              <Switch label="Canonical link" checked={meta.includeCanonical} onChange={set('includeCanonical')} />
              <Switch label="Open Graph tags" checked={meta.includeOpenGraph} onChange={set('includeOpenGraph')} />
              <Switch label="X (Twitter) tags" checked={meta.includeTwitter} onChange={set('includeTwitter')} />
            </div>
          </Section>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Preview"
            actions={
              <Segmented
                label="Preview type"
                size="sm"
                value={preview}
                onChange={setPreview}
                options={[
                  { value: 'search', label: 'Search' },
                  { value: 'social', label: 'Social' },
                  { value: 'chat', label: 'Chat' },
                ]}
              />
            }
          >
            {preview === 'search' && <SearchPreview m={meta} />}
            {preview === 'social' && <SocialPreview m={meta} />}
            {preview === 'chat' && <ChatPreview m={meta} />}
            <p className="mt-3 text-[12px] text-fg-muted">
              Approximate rendering. Each service truncates by its own rules and may crop images differently.
            </p>
          </Panel>
          {warnings.length > 0 && (
            <Alert tone="warning" title="Suggestions">
              <ul className="list-disc pl-4">
                {warnings.map((w) => (
                  <li key={w.field + w.message}>{w.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          <EditorPanel
            title="HTML for <head>"
            value={html}
            language="html"
            downloadName="meta-tags.html"
            downloadType="text/html"
            placeholder="Fill in the fields to generate tags"
            height="560px"
          />
        </div>
      </div>
    </ToolStack>
  );
}
