import { useRef } from 'react';
import { FileUp } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/utils';
import { readKeyFile } from './files';

/**
 * "Open file" icon button for key/certificate files. Unlike a plain text open, binary DER files
 * (.der/.cer) are converted to PEM so the text parsers can read them.
 */
export function KeyFileButton({
  accept,
  onText,
  label = 'Open file',
}: {
  accept: string;
  onText: (text: string, file: File) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <IconButton icon={FileUp} label={label} size="sm" onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            onText((await readKeyFile(file)).text, file);
          } catch (error) {
            toast(errorMessage(error, 'Could not read the file.'), 'error');
          }
        }}
      />
    </>
  );
}
