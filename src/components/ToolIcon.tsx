import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Category-tinted icon tile used for tools and categories. */
export function ToolIcon({
  icon: Icon,
  hue,
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  hue: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'sm' ? 'size-7 rounded-md' : size === 'lg' ? 'size-11 rounded-xl' : 'size-9 rounded-lg';
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 21 : 18;
  return (
    <span className={cn('lk-tint flex shrink-0 items-center justify-center', box, className)} style={{ '--hue': hue } as CSSProperties}>
      <Icon size={iconSize} aria-hidden strokeWidth={1.9} />
    </span>
  );
}
