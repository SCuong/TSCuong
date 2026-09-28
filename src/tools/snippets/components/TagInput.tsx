import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { MAX_TAGS, normalizeTags, parseTagInput } from '../lib/model';

/** Chip input for tags: Enter, comma or space adds; Backspace on empty input removes the last tag. */
export function TagInput({
  id,
  tags,
  onChange,
  suggestions,
}: {
  id?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [text, setText] = useState('');
  const listId = useId();

  function commit(value = text) {
    const next = parseTagInput(value);
    if (next.length) onChange(normalizeTags([...tags, ...next]));
    setText('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || (e.key === ' ' && text.trim())) {
      if (e.key === 'Enter' && !text.trim()) return;
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !text && tags.length) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  }

  const full = tags.length >= MAX_TAGS;

  return (
    <div className="lk-field flex min-h-[38px] flex-wrap items-center gap-1.5 py-1.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--lk-accent-soft)]">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-hover py-px pr-0.5 pl-1.5 text-[12px] font-medium text-fg-secondary"
        >
          {tag}
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
        id={id}
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
        placeholder={full ? 'Tag limit reached' : tags.length ? 'Add tag…' : 'e.g. react, hooks'}
        className="min-w-[8ch] flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-fg-muted"
        aria-label="Add tag"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !tags.includes(s))
          .slice(0, 50)
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
