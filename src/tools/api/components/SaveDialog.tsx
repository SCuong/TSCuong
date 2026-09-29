import { useEffect, useId, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import type { ApiCollection, SecretFinding } from '../lib/model';

export interface SaveTarget {
  name: string;
  /** Existing collection id, or null to create `newCollectionName`. */
  collectionId: string | null;
  newCollectionName: string;
  folderId: string | null;
  withoutSecrets: boolean;
}

const NEW = '__new__';

function SecretsNote({ secrets }: { secrets: SecretFinding[] }) {
  return (
    <Alert tone="warning" title="This request contains secrets">
      {secrets.map((s) => s.label).join(', ')}. Saved requests are stored unencrypted in this browser. You can save without them (the fields are kept,
      values left empty) or use {'{{variables}}'} from an environment instead.
    </Alert>
  );
}

export function SaveDialog({
  open,
  onClose,
  initialName,
  collections,
  preferredCollectionId,
  secrets,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initialName: string;
  collections: ApiCollection[];
  preferredCollectionId: string | null;
  secrets: SecretFinding[];
  onSave: (target: SaveTarget) => void;
}) {
  const [name, setName] = useState(initialName);
  const [collectionId, setCollectionId] = useState<string>(NEW);
  const [newName, setNewName] = useState('My requests');
  const [folderId, setFolderId] = useState<string>('');
  const ids = { name: useId(), coll: useId(), newColl: useId(), folder: useId() };

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    const preferred = collections.find((c) => c.id === preferredCollectionId) ?? collections[0];
    setCollectionId(preferred?.id ?? NEW);
    setFolderId('');
    setNewName(collections.length ? 'New collection' : 'My requests');
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const collection = collections.find((c) => c.id === collectionId);
  const valid = name.trim() !== '' && (collectionId !== NEW || newName.trim() !== '');
  const submit = (withoutSecrets: boolean) => {
    if (!valid) return;
    onSave({
      name: name.trim(),
      collectionId: collectionId === NEW ? null : collectionId,
      newCollectionName: newName.trim(),
      folderId: collection && folderId ? folderId : null,
      withoutSecrets,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save request"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {secrets.length > 0 && (
            <Button onClick={() => submit(true)} disabled={!valid}>
              Save without secrets
            </Button>
          )}
          <Button variant="primary" onClick={() => submit(false)} disabled={!valid}>
            {secrets.length ? 'Save with secrets' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!secrets.length) submit(false);
        }}
      >
        <div>
          <Label htmlFor={ids.name}>Name</Label>
          <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={ids.coll}>Collection</Label>
            <Select
              id={ids.coll}
              value={collectionId}
              onChange={(e) => {
                setCollectionId(e.target.value);
                setFolderId('');
              }}
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW}>New collection…</option>
            </Select>
          </div>
          {collectionId === NEW ? (
            <div>
              <Label htmlFor={ids.newColl}>New collection name</Label>
              <Input id={ids.newColl} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label htmlFor={ids.folder}>Folder</Label>
              <Select id={ids.folder} value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={!collection?.folders.length}>
                <option value="">No folder</option>
                {collection?.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        {secrets.length > 0 && <SecretsNote secrets={secrets} />}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function SecretsDialog({
  open,
  secrets,
  onCancel,
  onSave,
}: {
  open: boolean;
  secrets: SecretFinding[];
  onCancel: () => void;
  onSave: (withoutSecrets: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldAlert size={16} aria-hidden className="text-warning" /> Save with secrets?
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(true)}>Save without secrets</Button>
          <Button variant="primary" onClick={() => onSave(false)} autoFocus>
            Save with secrets
          </Button>
        </>
      }
    >
      <SecretsNote secrets={secrets} />
    </Dialog>
  );
}
