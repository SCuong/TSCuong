import { memo, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  highlightCode,
  loadSnippetLanguage,
  loadedSnippetLanguage,
  previewLines,
  tokensToLines,
  type LoadedLanguage,
} from '../lib/highlight';

/** Loaded language support for a snippet language id (undefined while loading). */
export function useSnippetLanguage(languageId: string): LoadedLanguage | undefined {
  const [state, setState] = useState<{ id: string; lang: LoadedLanguage } | null>(null);
  const cached = loadedSnippetLanguage(languageId);
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    void loadSnippetLanguage(languageId).then((lang) => {
      if (!cancelled) setState({ id: languageId, lang });
    });
    return () => {
      cancelled = true;
    };
  }, [languageId, cached]);
  return cached ?? (state?.id === languageId ? state.lang : undefined);
}

/** Compact, non-interactive preview of the first lines of a snippet (used in the list). */
export const CodePreview = memo(function CodePreview({
  code,
  language,
  lines = 3,
  className,
}: {
  code: string;
  language: string;
  lines?: number;
  className?: string;
}) {
  const lang = useSnippetLanguage(language);
  const text = useMemo(() => previewLines(code, lines), [code, lines]);
  const tokens = useMemo(() => highlightCode(text, lang?.parser ?? null), [text, lang]);
  return (
    <pre
      aria-hidden
      className={cn(
        'overflow-hidden font-mono text-[11.5px] leading-[1.55] whitespace-pre text-fg-secondary',
        className,
      )}
    >
      {text ? (
        tokens.map((t, i) =>
          t.cls ? (
            <span key={i} className={t.cls}>
              {t.text}
            </span>
          ) : (
            t.text
          ),
        )
      ) : (
        <span className="text-fg-muted italic">No code</span>
      )}
    </pre>
  );
});

/** Full read-only code block with line numbers and static syntax highlighting. */
export function CodeBlock({ code, language, className }: { code: string; language: string; className?: string }) {
  const lang = useSnippetLanguage(language);
  const lines = useMemo(() => tokensToLines(highlightCode(code, lang?.parser ?? null)), [code, lang]);
  if (!code) {
    return (
      <div className={cn('rounded-lg border border-line bg-surface-sunken p-4 text-[13px] text-fg-muted italic', className)}>
        This snippet has no code yet.
      </div>
    );
  }
  const gutter = String(lines.length).length;
  return (
    <div
      className={cn('overflow-auto rounded-lg border border-line bg-surface-sunken', className)}
      tabIndex={0}
      role="region"
      aria-label="Snippet code"
    >
      <pre className="min-w-max py-2.5 font-mono text-[13px] leading-[1.6] text-fg">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span
                aria-hidden
                className="sticky left-0 shrink-0 border-r border-line bg-surface-sunken pr-3 pl-3 text-right text-fg-muted select-none"
                style={{ width: `${gutter + 2.5}ch` }}
              >
                {i + 1}
              </span>
              <span className="pr-4 pl-3 whitespace-pre">
                {line.length === 0
                  ? '\u200B'
                  : line.map((t, j) =>
                      t.cls ? (
                        <span key={j} className={t.cls}>
                          {t.text}
                        </span>
                      ) : (
                        t.text
                      ),
                    )}
              </span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
