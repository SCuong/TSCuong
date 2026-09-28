import { useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Badge } from '@/components/ui/Panel';
import { Field, Input, Label, NumberInput, Select, Switch } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes, pluralize } from '@/lib/utils';
import { CHANGEFREQS, MAX_URLS, buildSitemap, todayIso, type Changefreq, type SitemapOptions } from './lib/sitemap';

const TOOL = 'sitemap-generator';
const SAMPLE = `https://www.example.com/
https://www.example.com/about
https://www.example.com/products/
https://www.example.com/products/trail-shoes?color=green&size=42
https://www.example.com/blog/
https://www.example.com/blog/how-to-choose-running-shoes
https://www.example.com/contact`;

interface Settings {
  baseUrl: string;
  lastmodMode: 'none' | 'today' | 'custom';
  lastmodCustom: string;
  changefreq: Changefreq | 'none';
  priority: SitemapOptions['priority'];
  priorityValue: number;
  removeDuplicates: boolean;
  stripFragments: boolean;
}

const DEFAULTS: Settings = {
  baseUrl: '',
  lastmodMode: 'today',
  lastmodCustom: todayIso(),
  changefreq: 'weekly',
  priority: 'depth',
  priorityValue: 0.5,
  removeDuplicates: true,
  stripFragments: true,
};

export default function SitemapGenerator() {
  const [input, setInput] = useToolState(TOOL, 'input', SAMPLE);
  const [stored, setSettings] = useToolState<Settings>(TOOL, 'settings', DEFAULTS);
  const s = { ...DEFAULTS, ...stored };
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((prev) => ({ ...DEFAULTS, ...prev, [key]: value }));
  const text = useDebouncedValue(input, input.length > 200_000 ? 300 : 0);

  const build = useMemo(
    () =>
      buildSitemap(text, {
        baseUrl: s.baseUrl,
        lastmod: s.lastmodMode === 'none' ? 'none' : 'date',
        lastmodValue: s.lastmodMode === 'today' ? todayIso() : s.lastmodCustom,
        changefreq: s.changefreq,
        priority: s.priority,
        priorityValue: s.priorityValue,
        removeDuplicates: s.removeDuplicates,
        stripFragments: s.stripFragments,
      }),
    [text, s.baseUrl, s.lastmodMode, s.lastmodCustom, s.changefreq, s.priority, s.priorityValue, s.removeDuplicates, s.stripFragments],
  );
  const errorCount = build.issues.filter((i) => i.level === 'error').length;
  const warningCount = build.issues.length - errorCount;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label htmlFor="sm-lastmod">Last modified</Label>
          <div className="flex gap-2">
            <Select id="sm-lastmod" value={s.lastmodMode} onChange={(e) => set('lastmodMode', e.target.value as Settings['lastmodMode'])} className="w-auto">
              <option value="none">Omit</option>
              <option value="today">Today</option>
              <option value="custom">Pick a date</option>
            </Select>
            {s.lastmodMode === 'custom' && (
              <Input type="date" aria-label="Last modified date" value={s.lastmodCustom} onChange={(e) => set('lastmodCustom', e.target.value)} className="w-auto" />
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="sm-freq">Change frequency</Label>
          <Select id="sm-freq" value={s.changefreq} onChange={(e) => set('changefreq', e.target.value as Settings['changefreq'])} className="w-auto">
            <option value="none">Omit</option>
            {CHANGEFREQS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sm-priority">Priority</Label>
          <div className="flex gap-2">
            <Select id="sm-priority" value={s.priority} onChange={(e) => set('priority', e.target.value as Settings['priority'])} className="w-auto">
              <option value="none">Omit</option>
              <option value="depth">By URL depth</option>
              <option value="fixed">Same for all</option>
            </Select>
            {s.priority === 'fixed' && (
              <NumberInput
                aria-label="Priority value"
                min={0}
                max={1}
                step={0.1}
                value={s.priorityValue}
                onChange={(v) => set('priorityValue', v === '' ? 0 : v)}
                className="w-20"
              />
            )}
          </div>
        </div>
        <Switch label="Remove duplicates" checked={s.removeDuplicates} onChange={(v) => set('removeDuplicates', v)} className="h-8" />
        <Switch label="Drop #fragments" checked={s.stripFragments} onChange={(v) => set('stripFragments', v)} className="h-8" />
      </ToolBar>
      <Panel>
        <Field label="Base URL for relative paths (optional)" hint="Lets you paste paths such as /about instead of full URLs.">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} mono value={s.baseUrl} placeholder="https://www.example.com/" spellCheck={false} onChange={(e) => set('baseUrl', e.target.value)} />
          )}
        </Field>
      </Panel>
      {build.errors.map((e) => (
        <ErrorMessage key={e} error={e} title="Cannot create the sitemap" />
      ))}
      {build.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      <SplitPanes>
        <EditorPanel
          title="URLs (one per line)"
          value={input}
          onChange={setInput}
          placeholder={'https://example.com/\nhttps://example.com/about'}
          sample={SAMPLE}
          fileAccept=".txt,.csv,text/plain"
          height="440px"
          lineWrapping={false}
          footer={
            input.trim() ? (
              <>
                <span>{pluralize(build.entries.length, 'URL')}</span>
                {errorCount > 0 && <span className="text-danger">{pluralize(errorCount, 'error')}</span>}
                {warningCount > 0 && <span className="text-warning">{pluralize(warningCount, 'warning')}</span>}
              </>
            ) : undefined
          }
        />
        <EditorPanel
          title="sitemap.xml"
          value={build.xml}
          language="xml"
          downloadName="sitemap.xml"
          downloadType="application/xml"
          placeholder={input.trim() ? 'Fix the problems above to generate the sitemap' : 'Paste URLs to generate a sitemap'}
          height="440px"
          footer={
            build.xml ? (
              <>
                <span className="text-success">
                  {build.entries.length.toLocaleString()} of {MAX_URLS.toLocaleString()} URLs
                </span>
                <span>{formatBytes(build.bytes)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
      {build.issues.length > 0 && (
        <Panel title={`Problems (${build.issues.length})`} description="Lines with errors are left out of the sitemap." bodyClassName="p-0">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead className="sticky top-0 bg-surface text-[12px] text-fg-muted">
                <tr className="border-b border-line">
                  <th className="w-14 py-2 pr-2 pl-4 font-medium">Line</th>
                  <th className="py-2 pr-3 font-medium">URL</th>
                  <th className="py-2 pr-4 font-medium">Problem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {build.issues.slice(0, 500).map((i) => (
                  <tr key={`${i.line}-${i.message}`} className="align-top">
                    <td className="py-1.5 pr-2 pl-4 text-fg-muted tabular-nums">{i.line}</td>
                    <td className="max-w-[320px] py-1.5 pr-3 font-mono text-[12.5px] break-all text-fg">{i.input}</td>
                    <td className="py-1.5 pr-4">
                      <Badge tone={i.level === 'error' ? 'danger' : 'warning'} className="mr-1.5">
                        {i.level}
                      </Badge>
                      <span className="text-fg-secondary">{i.message}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {build.issues.length > 500 && <p className="px-4 py-2 text-[12.5px] text-fg-muted">Showing the first 500 problems.</p>}
          </div>
        </Panel>
      )}
    </ToolStack>
  );
}
