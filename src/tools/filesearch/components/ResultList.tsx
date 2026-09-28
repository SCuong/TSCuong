import { File as FileIcon, FileCode, FileText, Image } from 'lucide-react';
import { cn, formatBytes, formatNumber } from '@/lib/utils';
import type { ResultItem } from '../lib/protocol';
import { isImageFile, isTextFile } from '../lib/textFormats';
import { Highlighted } from './Highlighted';

const CODE = /\.(m?[jt]sx?|c?js|py|go|rs|java|kt|c|h|cc|cpp|hpp|cs|rb|php|html?|css|scss|sql|sh|vue|svelte|swift|json|ya?ml|toml|xml)$/i;

export function fileIcon(name: string) {
  if (isImageFile(name)) return Image;
  if (CODE.test(name)) return FileCode;
  if (isTextFile(name)) return FileText;
  return FileIcon;
}

export function ResultList({
  items,
  selectedId,
  onSelect,
}: {
  items: ResultItem[];
  selectedId: number | null;
  onSelect: (item: ResultItem) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line" aria-label="Search results">
      {items.map((item) => {
        const Icon = fileIcon(item.meta.name);
        const selected = item.meta.id === selectedId;
        const dir = item.meta.path.includes('/') ? item.meta.path.slice(0, item.meta.path.lastIndexOf('/')) : '';
        return (
          <li key={item.meta.id}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left transition-colors',
                selected ? 'bg-accent-soft' : 'hover:bg-surface-hover',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon size={15} className={cn('shrink-0', selected ? 'text-accent-text' : 'text-fg-muted')} aria-hidden />
                <Highlighted segments={item.nameSegments} className="min-w-0 truncate text-[13.5px] font-medium text-fg" />
                <span className="ml-auto shrink-0 text-[11.5px] text-fg-muted tabular-nums">{formatBytes(item.meta.size)}</span>
              </div>
              {dir && (
                <Highlighted
                  segments={item.pathSegments.length > 1 ? item.pathSegments : [{ text: dir, hit: false }]}
                  className="truncate pl-[23px] font-mono text-[11.5px] text-fg-muted"
                />
              )}
              {item.snippets.length > 0 && (
                <div className="mt-0.5 ml-[23px] flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-surface-sunken py-1">
                  {item.snippets.map((s) => (
                    <div key={s.line} className="flex min-w-0 gap-2 px-2 font-mono text-[11.5px] leading-5">
                      <span className="w-9 shrink-0 text-right text-fg-muted tabular-nums select-none">{s.line}</span>
                      <Highlighted segments={s.segments} className="min-w-0 truncate whitespace-pre text-fg-secondary" />
                    </div>
                  ))}
                  {item.matchingLines > item.snippets.length && (
                    <span className="px-2 pl-[52px] text-[11px] text-fg-muted">
                      +{formatNumber(item.matchingLines - item.snippets.length, 0)} more matching line
                      {item.matchingLines - item.snippets.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
