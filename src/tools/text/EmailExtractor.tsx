import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { DEFAULT_EMAIL_OPTIONS, extractEmails, findEmails, groupByDomain, type EmailExtractOptions } from './lib/extract';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'email-extractor';
const SAMPLE = `From: Alice Smith <Alice.Smith@Example.com>
To: bob@example.com, carol+newsletter@mail.example.org
Cc: support@company.io; bob@EXAMPLE.com
Reply to dave@company.io or visit https://company.io/?ref=eve@partner.net
Invalid: not-an-email@, @example.com, frank@localhost`;

interface Settings extends EmailExtractOptions {
  layout: 'list' | 'grouped';
  separator: 'newline' | 'comma' | 'semicolon';
}

const DEFAULTS: Settings = { ...DEFAULT_EMAIL_OPTIONS, layout: 'list', separator: 'newline' };

export default function EmailExtractor() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [s, setS] = useToolState<Settings>(ID, 'settings', DEFAULTS);
  const [domainFilter, setDomainFilter] = useToolState(ID, 'domain', '');
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((prev) => ({ ...prev, [key]: value }));

  const deferred = useDeferredValue(input);
  const emails = useMemo(() => {
    const all = extractEmails(deferred, s);
    const filter = domainFilter.trim().toLowerCase().replace(/^@/, '');
    return filter ? all.filter((e) => e.slice(e.lastIndexOf('@') + 1).toLowerCase().includes(filter)) : all;
  }, [deferred, s, domainFilter]);
  const groups = useMemo(() => groupByDomain(emails), [emails]);
  const found = useMemo(() => findEmails(deferred).length, [deferred]);

  const sep = s.separator === 'comma' ? ', ' : s.separator === 'semicolon' ? '; ' : '\n';
  const output =
    s.layout === 'grouped'
      ? groups.map((g) => `# ${g.domain} (${g.emails.length})\n${g.emails.join('\n')}`).join('\n\n')
      : emails.join(sep);

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Output">
          <Segmented
            label="Output layout"
            value={s.layout}
            onChange={(v) => set('layout', v)}
            options={[
              { value: 'list', label: 'List' },
              { value: 'grouped', label: 'Grouped by domain' },
            ]}
          />
        </Opt>
        {s.layout === 'list' && (
          <Opt label="Separator">
            <Segmented
              label="Separator"
              value={s.separator}
              onChange={(v) => set('separator', v)}
              options={[
                { value: 'newline', label: 'New line' },
                { value: 'comma', label: 'Comma' },
                { value: 'semicolon', label: 'Semicolon' },
              ]}
            />
          </Opt>
        )}
        <Opt label="Domain contains" className="w-44">
          <Input value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} placeholder="e.g. example.com" aria-label="Filter by domain" />
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label="Remove duplicates" checked={s.dedupe} onChange={(v) => set('dedupe', v)} />
          <Switch label="Lowercase" checked={s.lowercase} onChange={(v) => set('lowercase', v)} />
          <Switch label="Sort A → Z" checked={s.sort} onChange={(v) => set('sort', v)} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Text"
          value={input}
          onChange={setInput}
          placeholder="Paste e-mails, contact lists, HTML or CSV…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="420px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="E-mail addresses"
          value={output}
          placeholder={input ? 'No e-mail addresses found' : 'Addresses appear here'}
          downloadName="emails.txt"
          height="420px"
          lineWrapping={s.layout === 'list' && s.separator !== 'newline'}
          footer={
            input ? (
              <>
                <span>{pluralize(emails.length, 'address', 'addresses')}</span>
                <span>{pluralize(groups.length, 'domain')}</span>
                {found > emails.length && <span>{found - emails.length} duplicate or filtered</span>}
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
