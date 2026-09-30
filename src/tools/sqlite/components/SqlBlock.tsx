import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/ui/Actions';

type Piece = { text: string; cls: string | null };

/** Read-only SQL with static syntax colouring (lezer highlighter, loaded lazily). */
export function SqlBlock({ sql }: { sql: string }) {
  const [pieces, setPieces] = useState<Piece[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ sql: sqlLang }, { highlightCode, classHighlighter }] = await Promise.all([
          import('@codemirror/lang-sql'),
          import('@lezer/highlight'),
        ]);
        const tree = sqlLang().language.parser.parse(sql);
        const out: Piece[] = [];
        highlightCode(
          sql,
          tree,
          classHighlighter,
          (text, classes) => out.push({ text, cls: classes || null }),
          () => out.push({ text: '\n', cls: null }),
        );
        if (!cancelled) setPieces(out);
      } catch {
        if (!cancelled) setPieces(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sql]);

  return (
    <div className="relative rounded-lg border border-line bg-surface-sunken">
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={sql} iconOnly />
      </div>
      <pre tabIndex={0} role="region" aria-label="SQL definition" className="overflow-x-auto px-3 py-2.5 pr-10 font-mono text-[12.5px] leading-relaxed text-fg">
        {pieces
          ? pieces.map((p, i) =>
              p.cls ? (
                <span key={i} className={p.cls}>
                  {p.text}
                </span>
              ) : (
                p.text
              ),
            )
          : sql}
      </pre>
    </div>
  );
}
