import { useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useObjectUrl } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export type PreviewBg = 'checker' | 'light' | 'dark';

/**
 * Renders SVG markup through an <img> with a blob URL. Images never run
 * scripts or load external resources, so untrusted SVG is safe to preview.
 */
export function SvgPreview({
  svg,
  background = 'checker',
  className,
  label = 'SVG preview',
  maxHeight = 320,
}: {
  svg: string;
  background?: PreviewBg;
  className?: string;
  label?: string;
  maxHeight?: number;
}) {
  const blob = useMemo(() => (svg.trim() ? new Blob([svg], { type: 'image/svg+xml' }) : null), [svg]);
  const url = useObjectUrl(blob);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = url !== null && failedUrl === url;
  return (
    <div
      className={cn(
        'flex min-h-40 items-center justify-center overflow-hidden rounded-lg border border-line p-3',
        background === 'checker' && 'lk-checker',
        className,
      )}
      style={background === 'light' ? { backgroundColor: '#ffffff' } : background === 'dark' ? { backgroundColor: '#0b0e14' } : undefined}
    >
      {url && !failed ? (
        <img src={url} alt={label} className="max-w-full object-contain" style={{ maxHeight }} onError={() => setFailedUrl(url)} />
      ) : (
        <div className="flex flex-col items-center gap-1.5 text-center text-[13px] text-fg-muted">
          <ImageOff size={18} aria-hidden />
          {failed ? 'The browser could not render this SVG.' : 'Nothing to preview'}
        </div>
      )}
    </div>
  );
}
