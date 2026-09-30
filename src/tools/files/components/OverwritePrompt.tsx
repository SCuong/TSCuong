import { useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { formatNumber } from '@/lib/utils';

export type OverwriteChoice = 'replace' | 'skip' | 'cancel';

const SHOWN = 8;

/**
 * Asks what to do when files about to be written already exist in the chosen folder. `ask` resolves with
 * the choice; render `dialog` somewhere in the component.
 */
export function useOverwritePrompt(): { ask: (names: string[], note?: string) => Promise<OverwriteChoice>; dialog: ReactNode } {
  const [names, setNames] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | undefined>(undefined);
  const resolver = useRef<((choice: OverwriteChoice) => void) | null>(null);

  const ask = (list: string[], extra?: string) =>
    new Promise<OverwriteChoice>((resolve) => {
      resolver.current?.('cancel');
      resolver.current = resolve;
      setNote(extra);
      setNames(list);
    });
  const choose = (choice: OverwriteChoice) => {
    resolver.current?.(choice);
    resolver.current = null;
    setNames(null);
  };

  const count = names?.length ?? 0;
  const dialog = (
    <Dialog
      open={names !== null}
      onClose={() => choose('cancel')}
      title={count === 1 ? '1 file already exists' : `${formatNumber(count, 0)} files already exist`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => choose('cancel')}>
            Cancel
          </Button>
          <Button onClick={() => choose('skip')} autoFocus>
            Keep existing
          </Button>
          <Button variant="danger" onClick={() => choose('replace')}>
            Replace
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-fg-secondary">
        The folder you chose already contains {count === 1 ? 'a file' : 'files'} with {count === 1 ? 'this name' : 'these names'}. Replacing
        cannot be undone; “Keep existing” writes only the other files.
      </p>
      {note && <p className="mt-2 text-[13px] font-medium text-warning">{note}</p>}
      <ul className="mt-3 flex flex-col gap-1 font-mono text-[12.5px] break-all text-fg">
        {(names ?? []).slice(0, SHOWN).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {count > SHOWN && <p className="mt-2 text-[12.5px] text-fg-muted">…and {formatNumber(count - SHOWN, 0)} more.</p>}
    </Dialog>
  );
  return { ask, dialog };
}
