import type { Segment } from '../lib/snippets';

/** Renders text segments, wrapping hits in <mark>. */
export function Highlighted({ segments, className }: { segments: Segment[]; className?: string }) {
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.hit ? (
          <mark key={i} className="lk-hl-match text-inherit">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
