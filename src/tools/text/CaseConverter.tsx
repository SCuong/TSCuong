import { useDeferredValue, useMemo } from 'react';
import { CaseSensitive } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { CopyButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { CASE_VARIANTS } from './lib/case';
import { TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const SAMPLE = 'The quick brown fox jumps over the lazy dog\nXMLHttpRequest userAccountId\ncrème brûlée à la carte';

export default function CaseConverter() {
  const [input, setInput] = useToolState('case-converter', 'input', '');
  const deferred = useDeferredValue(input);
  const results = useMemo(
    () => (deferred ? CASE_VARIANTS.map((v) => ({ ...v, value: v.convert(deferred) })) : []),
    [deferred],
  );

  return (
    <ToolStack>
      <EditorPanel
        title="Text"
        value={input}
        onChange={setInput}
        placeholder="Type or paste text to convert…"
        sample={SAMPLE}
        fileAccept={TEXT_FILE_ACCEPT}
        height="180px"
        footer={<TextFooter text={input} />}
      />
      {results.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <EmptyState icon={CaseSensitive} title="Every case at once">
            Enter text above to see camelCase, snake_case, Title Case and 11 more variants, each with its own copy button.
          </EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((r) => (
            <section key={r.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
              <header className="flex items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
                <h2 className="truncate font-mono text-[12.5px] font-semibold text-fg-secondary">{r.label}</h2>
                <CopyButton value={r.value} iconOnly label={`Copy ${r.label}`} />
              </header>
              <pre className="max-h-40 min-h-12 overflow-auto px-4 py-2.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fg">
                {r.value || <span className="text-fg-muted">(no words)</span>}
              </pre>
            </section>
          ))}
        </div>
      )}
    </ToolStack>
  );
}
