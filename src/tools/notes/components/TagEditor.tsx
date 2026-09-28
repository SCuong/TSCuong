import { useId, useState, type KeyboardEvent } from 'react';
import { Hash, X } from 'lucide-react';
import { normalizeTag, parseTags } from '../lib/notes';

const MAX_TAGS = 20;

/** Inline tag chips: Enter, comma or space adds a tag; Backspace in the empty input removes the last one. */
export function TagEditor({
  tags,
  onChange,
  suggestions,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [text, setText] = useState('');
  const listId = useId();
  const inputId = useId();
  const full = tags.length >= MAX_TAGS;

  function commit(value = text) {
    const added = parseTags(value).filter((t) => !tags.includes(t));
    if (added.length) onChange([...tags, ...added].slice(0, MAX_TAGS));
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || (e.key === ' ' && text.trim())) {
      if (!text.trim()) return;
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !text && tags.length) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    } else if (e.key === 'Escape' && text) {
      e.preventDefault();
      setText('');
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <label htmlFor={inputId} className="text-fg-muted" title="Tags">
        <Hash size={14} aria-hidden />
        <span className="sr-only">Tags</span>
      </label>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex max-w-full items-center gap-0.5 rounded-md border border-line bg-surface-hover py-px pr-0.5 pl-1.5 text-[12px] font-medium text-fg-secondary"
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            aria-label={`Remove tag ${tag}`}
            className="rounded p-0.5 text-fg-muted hover:bg-line hover:text-fg"
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        value={text}
        disabled={full}
        onChange={(e) => {
          const value = e.target.value;
          if (/[,\n]/.test(value)) commit(value);
          else setText(value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && commit()}
        list={listId}
        placeholder={full ? 'Tag limit reached' : tags.length ? 'Add tag' : 'Add tags…'}
        aria-label="Add tag"
        className="h-6 min-w-[9ch] flex-1 rounded bg-transparent px-1 text-[13px] text-fg outline-none placeholder:text-fg-muted focus-visible:bg-surface-sunken"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !tags.includes(s) && (!text || s.startsWith(normalizeTag(text))))
          .slice(0, 50)
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
