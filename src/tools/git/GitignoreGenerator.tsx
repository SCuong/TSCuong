import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { EditorPanel } from '@/components/tool/EditorPanel';
import { Button } from '@/components/ui/Button';
import { Input, Switch } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { GITIGNORE_TEMPLATES, TEMPLATE_GROUPS, getTemplate, mergeGitignore, searchTemplates } from './lib/gitignore';
import { ToggleChip } from './shared';

const TOOL = 'gitignore-generator';

export default function GitignoreGenerator() {
  const [selected, setSelected] = useToolState<string[]>(TOOL, 'selected', []);
  const [custom, setCustom] = useToolState(TOOL, 'custom', '');
  const [headers, setHeaders] = useToolState(TOOL, 'headers', true);
  const [query, setQuery] = useState('');

  const valid = useMemo(() => selected.filter((id) => getTemplate(id)), [selected]);
  const matches = useMemo(() => new Set(searchTemplates(query).map((t) => t.id)), [query]);
  const result = useMemo(() => mergeGitignore(valid, custom, { headers }), [valid, custom, headers]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel
          title="Templates"
          description={`${GITIGNORE_TEMPLATES.length} curated templates; pick any combination`}
          actions={
            valid.length > 0 && (
              <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected([])}>
                Clear {valid.length}
              </Button>
            )
          }
        >
          <div className="relative mb-4">
            <Search size={15} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: node, python, intellij, terraform…"
              aria-label="Search templates"
              className="pl-9"
            />
          </div>
          {matches.size === 0 ? (
            <EmptyState icon={Search} title="No template matches" className="py-6">
              Try another word, or add your own patterns under “Custom patterns”.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              {TEMPLATE_GROUPS.map((group) => {
                const items = GITIGNORE_TEMPLATES.filter((t) => t.group === group && matches.has(t.id));
                if (!items.length) return null;
                return (
                  <section key={group} aria-label={group}>
                    <h3 className="mb-2 text-[12px] font-semibold tracking-wide text-fg-muted uppercase">{group}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((t) => (
                        <ToggleChip key={t.id} pressed={valid.includes(t.id)} onToggle={() => toggle(t.id)}>
                          {t.name}
                        </ToggleChip>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </Panel>
        <EditorPanel
          title="Custom patterns"
          value={custom}
          onChange={setCustom}
          placeholder={'# One pattern per line, e.g.\nsecrets.json\n/uploads/\n*.sqlite'}
          height="150px"
        />
      </div>
      <EditorPanel
        title=".gitignore"
        value={result.text}
        downloadName=".gitignore"
        placeholder="Select templates or add custom patterns to build your .gitignore."
        height="620px"
        className="lg:sticky lg:top-4 lg:self-start"
        actions={<Switch label="Headers" checked={headers} onChange={setHeaders} className="mr-1" />}
        footer={
          result.text ? (
            <>
              <span>{pluralize(result.patterns, 'pattern')}</span>
              {result.duplicates > 0 && <Badge tone="accent">{pluralize(result.duplicates, 'duplicate')} removed</Badge>}
              <span className="truncate">{valid.map((id) => getTemplate(id)?.name).join(' + ')}</span>
            </>
          ) : undefined
        }
      />
    </div>
  );
}
