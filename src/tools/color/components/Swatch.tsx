import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { copyText, cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { readableTextOn, parseAny } from '../lib/color';

/** A color chip that copies its hex value when clicked. */
export function SwatchButton({
  hex,
  label,
  sublabel,
  marker,
  className,
}: {
  hex: string;
  label?: string;
  sublabel?: string;
  marker?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fg = readableTextOn(parseAny(hex));

  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(hex)) {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1200);
        } else toast('Copy failed. Your browser blocked clipboard access.', 'error');
      }}
      title={`Copy ${hex}`}
      aria-label={`${label ? `${label}: ` : ''}${hex}. Click to copy.`}
      className={cn(
        'group relative flex min-h-20 flex-col justify-end rounded-lg p-2.5 text-left ring-1 ring-black/5 ring-inset transition-transform hover:-translate-y-0.5 dark:ring-white/10',
        className,
      )}
      style={{ background: hex, color: fg }}
    >
      {marker && (
        <span className="absolute top-2 right-2 rounded px-1 text-[10.5px] font-semibold uppercase" style={{ border: `1px solid ${fg}` }}>
          Base
        </span>
      )}
      {label && <span className="text-[12.5px] font-semibold">{label}</span>}
      <span className="flex items-center gap-1 font-mono text-[12px] opacity-90">
        {copied ? (
          <>
            <Check size={12} aria-hidden /> Copied
          </>
        ) : (
          hex
        )}
      </span>
      {sublabel && <span className="text-[11px] opacity-75">{sublabel}</span>}
    </button>
  );
}
