import { useState } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * Before/after comparison: the "after" image is revealed from the left up to
 * the slider position. A full-size transparent range input drives it, so it
 * works with mouse, touch and keyboard.
 */
export function CompareSlider({
  before,
  after,
  beforeLabel = 'Original',
  afterLabel = 'Result',
  width,
  height,
  className,
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** Intrinsic size, used for the aspect ratio of the frame. */
  width: number;
  height: number;
  className?: string;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div className={cn('flex justify-center', className)}>
      <div
        className="lk-checker relative max-h-[70vh] w-full overflow-hidden rounded-lg border border-line select-none"
        style={{ aspectRatio: `${width} / ${height}`, maxWidth: `min(100%, calc(70vh * ${width / height}))` }}
      >
        <img src={before} alt={beforeLabel} className="absolute inset-0 size-full object-contain" draggable={false} />
        <img
          src={after}
          alt={afterLabel}
          className="absolute inset-0 size-full object-contain"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          draggable={false}
        />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]" style={{ left: `calc(${pos}% - 1px)` }}>
          <div className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/20 bg-white text-[11px] font-bold text-neutral-700 shadow-md">
            ⇆
          </div>
        </div>
        <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {afterLabel}
        </span>
        <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {beforeLabel}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label={t('Comparison position: left shows {afterLabel}, right shows {beforeLabel}', { afterLabel: afterLabel.toLowerCase(), beforeLabel: beforeLabel.toLowerCase() })}
          className="absolute inset-0 size-full cursor-ew-resize opacity-0"
        />
      </div>
    </div>
  );
}
