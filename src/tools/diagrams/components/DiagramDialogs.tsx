import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { DIAGRAM_TEMPLATES, type DiagramTemplate } from '../lib/templates';

/** Picker for starting a new diagram from one of the templates. */
export function TemplateDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (template: DiagramTemplate) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="New diagram" description="Start from an example of any diagram type." size="lg">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DIAGRAM_TEMPLATES.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onPick(t)}
              className="flex h-full w-full flex-col items-start rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent-line hover:bg-accent-soft"
            >
              <span className="text-[13.5px] font-medium text-fg">{t.name}</span>
              <span className="mt-0.5 text-[12.5px] text-fg-muted">{t.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Rename dialog with validation (non-empty, max 80 characters). */
export function RenameDialog({
  open,
  initial,
  onClose,
  onSave,
  title = 'Rename diagram',
}: {
  open: boolean;
  initial: string;
  onClose: () => void;
  onSave: (name: string) => void;
  title?: string;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm">
      {open && <RenameForm initial={initial} onClose={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function RenameForm({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onSave(trimmed.slice(0, 80));
      }}
      className="flex flex-col gap-4"
    >
      <div>
        <label htmlFor="lk-rename" className="mb-1.5 block text-[13px] font-medium text-fg-secondary">
          Name
        </label>
        <Input id="lk-rename" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
        {!trimmed && <p className="mt-1.5 text-[12.5px] text-danger">The name cannot be empty.</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!trimmed}>
          Save
        </Button>
      </div>
    </form>
  );
}
