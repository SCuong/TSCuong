import { useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Select, Switch } from '@/components/ui/Field';
import { CopyButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { useToolState } from '@/lib/hooks';
import { CODE_TARGETS, generateCode, toCodeRequest, type CodeTarget } from '../lib/codegen';
import type { PrepareResult } from '../lib/prepare';

export function CodeDialog({ open, onClose, prepared }: { open: boolean; onClose: () => void; prepared: PrepareResult | null }) {
  const [target, setTarget] = useToolState<CodeTarget>('api-client', 'codeTarget', 'curl');
  // Secrets are opt-in every time the dialog is used and never remembered.
  const [secretsFlag, setSecretsFlag] = useState(false);
  const includeSecrets = open && secretsFlag;
  const meta = CODE_TARGETS.find((t) => t.id === target) ?? CODE_TARGETS[0];

  const code = useMemo(() => {
    if (!prepared || !prepared.ok) return '';
    return generateCode(toCodeRequest(prepared.request, includeSecrets), meta.id);
  }, [prepared, includeSecrets, meta.id]);

  return (
    <Dialog
      open={open}
      onClose={() => {
        setSecretsFlag(false);
        onClose();
      }}
      size="lg"
      title="Generate code"
      description="The request with variables resolved, as a snippet you can run elsewhere."
      footer={<CopyButton value={code} label="Copy code" variant="primary" size="md" />}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Select aria-label="Language" value={meta.id} onChange={(e) => setTarget(e.target.value as CodeTarget)} className="w-auto">
            {CODE_TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
          <Switch label="Include secrets" checked={includeSecrets} onChange={setSecretsFlag} />
        </div>
        {includeSecrets ? (
          <p className="text-[12.5px] text-warning">Tokens, passwords and API keys appear in the code. Do not share or commit it.</p>
        ) : (
          <p className="text-[12.5px] text-fg-muted">Auth values and sensitive headers are replaced by placeholders such as &lt;token&gt;.</p>
        )}
        {prepared && !prepared.ok ? (
          <ErrorMessage error={prepared.error} title="The request cannot be converted yet" />
        ) : (
          <div className="h-[360px] overflow-hidden rounded-lg border border-line">
            <CodeEditor value={code} readOnly language={meta.language} ariaLabel={`${meta.label} code`} className="h-full" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
