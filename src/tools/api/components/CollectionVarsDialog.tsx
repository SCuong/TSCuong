import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import type { ApiCollection, KeyValue } from '../lib/model';
import { collectionsDb } from '../lib/store';
import { KeyValueEditor } from './KeyValueEditor';

/** Edit a collection's variables (the base layer; the active environment overrides them). */
export function CollectionVarsDialog({ collection, onClose }: { collection: ApiCollection | null; onClose: () => void }) {
  const [rows, setRows] = useState<KeyValue[]>([]);
  useEffect(() => {
    if (collection) setRows(structuredClone(collection.variables));
  }, [collection]);

  async function save() {
    if (!collection) return;
    try {
      await collectionsDb.put({ ...collection, variables: rows.filter((r) => r.key.trim() || r.value), updatedAt: Date.now() });
      onClose();
    } catch {
      toast('Could not save the variables.', 'error');
    }
  }

  return (
    <Dialog
      open={collection !== null}
      onClose={onClose}
      size="lg"
      title={`Variables of “${collection?.name ?? ''}”`}
      description="Available as {{name}} in this collection's requests. Values in the active environment take precedence."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <KeyValueEditor<KeyValue> label="Collection variables" rows={rows} onChange={setRows} makeRow={(r) => r} scope={new Map()} keyLabel="Variable" keyPlaceholder="name" />
    </Dialog>
  );
}
