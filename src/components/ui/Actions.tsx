import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { copyText, downloadBlob } from '@/lib/utils';
import { Button, IconButton, type ButtonSize, type ButtonVariant } from './Button';
import { toast } from './Toast';

/** Copies text (or the result of a function) and confirms visually. Disabled when there is nothing to copy. */
export function CopyButton({
  value,
  label = 'Copy',
  iconOnly,
  size = 'sm',
  variant = 'secondary',
  className,
}: {
  value: string | (() => string);
  label?: string;
  iconOnly?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const empty = typeof value === 'string' && value.length === 0;

  async function onCopy() {
    const text = typeof value === 'function' ? value() : value;
    if (!text) return;
    const ok = await copyText(text);
    if (!ok) {
      toast('Copy failed. Your browser blocked clipboard access.', 'error');
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }

  if (iconOnly) {
    return (
      <IconButton
        icon={copied ? Check : Copy}
        label={copied ? 'Copied' : label}
        size="sm"
        disabled={empty}
        onClick={onCopy}
        className={className}
        active={copied}
      />
    );
  }
  return (
    <Button size={size} variant={variant} icon={copied ? Check : Copy} disabled={empty} onClick={onCopy} className={className}>
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function DownloadButton({
  data,
  filename,
  type,
  label = 'Download',
  size = 'sm',
  variant = 'secondary',
  disabled,
  className,
}: {
  data: Blob | string | (() => Blob | string | Promise<Blob | string>);
  filename: string | (() => string);
  type?: string;
  label?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
}) {
  const empty = typeof data === 'string' && data.length === 0;
  return (
    <Button
      size={size}
      variant={variant}
      icon={Download}
      disabled={disabled || empty}
      className={className}
      onClick={async () => {
        try {
          const value = typeof data === 'function' ? await data() : data;
          downloadBlob(value, typeof filename === 'function' ? filename() : filename, type);
        } catch {
          toast('Could not prepare the download.', 'error');
        }
      }}
    >
      {label}
    </Button>
  );
}
