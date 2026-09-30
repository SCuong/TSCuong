import { useDeferredValue, useMemo } from 'react';
import { CaseSensitive } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { CopyButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { formatNumber } from '@/lib/utils';
import { CASE_VARIANTS } from './lib/case';
import { TEXT_FILE_ACCEPT, TextFooter } from './components/shared';
import { t } from '@/lib/i18n';

const SAMPLE = 'The quick brown fox jumps over the lazy dog\nXMLHttpRequest userAccountId\ncrème brûlée à la carte';
/** Each card shows at most this much; Copy always converts the whole text. */
const PREVIEW_CHARS = 10_000;

/** The first `max` characters, ending at a line break when one is near, never splitting a surrogate pair. */
function previewOf(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.lastIndexOf('\n', max);
  if (cut < max * 0.8) cut = max;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return text.slice(0, cut);
}

export default function CaseConverter() {
  const [input, setInput] = useToolState('case-converter', 'input', '');
  const deferred = useDeferredValue(input);
  const truncated = deferred.length > PREVIEW_CHARS;
  const results = useMemo(() => {
    if (!deferred) return [];
    const preview = previewOf(deferred, PREVIEW_CHARS);
    return CASE_VARIANTS.map((v) => ({ ...v, value: v.convert(preview) }));
  }, [deferred]);

  return (
    <ToolStack>
      <EditorPanel
        title={t('Text')}
        value={input}
        onChange={setInput}
        placeholder={t('Type or paste text to convert…')}
        sample={SAMPLE}
        fileAccept={TEXT_FILE_ACCEPT}
        height="180px"
        footer={<TextFooter text={input} />}
      />
      {results.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <EmptyState icon={CaseSensitive} title={t('Every case at once')}>
            {t('Enter text above to see camelCase, snake_case, Title Case and 11 more variants, each with its own copy button.')}
          </EmptyState>
        </div>
      ) : (
        <>
          {truncated && (
            <p className="text-[12.5px] text-fg-muted">
              {t('The cards preview the first {PREVIEW_CHARS} characters. Copy converts the whole text.', { PREVIEW_CHARS: formatNumber(PREVIEW_CHARS, 0) })}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((r) => (
              <section key={r.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
                <header className="flex items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
                  <h2 className="truncate font-mono text-[12.5px] font-semibold text-fg-secondary">{r.label}</h2>
                  <CopyButton value={truncated ? () => r.convert(deferred) : r.value} iconOnly label={t('Copy {label}', { label: r.label })} />
                </header>
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label={r.label}
                  className="max-h-40 min-h-12 overflow-auto px-4 py-2.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fg"
                >
                  {r.value || <span className="text-fg-muted">{t('(no words)')}</span>}
                  {truncated && r.value && <span className="text-fg-muted">…</span>}
                </pre>
              </section>
            ))}
          </div>
        </>
      )}
    </ToolStack>
  );
}
