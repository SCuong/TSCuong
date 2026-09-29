import { useDeferredValue, useMemo } from 'react';
import { CircleCheck, CircleX, Crosshair } from 'lucide-react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Button } from '@/components/ui/Button';
import { Select, Switch } from '@/components/ui/Field';
import { Panel, Stat } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn, formatBytes, formatNumber } from '@/lib/utils';
import { utf8Bytes, type IndentOption } from './lib/common';
import { formatXml, minifyXml, xmlStats, type AttributeLayout, type EmptyElementStyle } from './lib/xmlFormat';
import { Option, TextStats, useEditorView, useProblemMarkers } from './shared/ConvertUi';

const TOOL = 'xml-formatter';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE catalog [<!ENTITY publisher "LocalKit Press">]>
<!-- Book catalog -->
<catalog xmlns="urn:example:books" xmlns:dc="http://purl.org/dc/elements/1.1/"><book id="bk101" lang="en" format="paperback" available="true"><dc:title>XML Developer's Guide</dc:title><author>Gambardella, Matthew</author><price currency="USD">44.95</price><description><![CDATA[An in-depth look at <XML> & friends.]]></description><publisher>&publisher;</publisher></book><book id="bk102"><dc:title>Midnight Rain</dc:title><author>Ralls, Kim</author><price currency="EUR">5.95</price><note>A <em>short</em> read.</note><reviews/></book></catalog>`;

type Mode = 'format' | 'minify';

interface Settings {
  mode: Mode;
  indent: IndentOption;
  attributes: AttributeLayout;
  emptyElements: EmptyElementStyle;
  doubleQuotes: boolean;
  removeComments: boolean;
}

export default function XmlFormatter() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [s, setS] = useToolState<Settings>(TOOL, 'settings', {
    mode: 'format',
    indent: '2',
    attributes: 'inline',
    emptyElements: 'keep',
    doubleQuotes: false,
    removeComments: false,
  });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));
  const editor = useEditorView();

  const deferred = useDeferredValue(input);
  const result = useMemo(() => {
    if (!deferred.trim()) return null;
    return s.mode === 'minify' ? minifyXml(deferred, { removeComments: s.removeComments }) : formatXml(deferred, s);
  }, [deferred, s]);
  const stats = useMemo(() => (result?.ok ? xmlStats(deferred) : null), [result, deferred]);

  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;
  const markers = useProblemMarkers(error);
  const inBytes = useMemo(() => utf8Bytes(deferred), [deferred]);
  const outBytes = useMemo(() => utf8Bytes(output), [output]);

  return (
    <ToolStack>
      <ToolBar>
        <Option label="Mode">
          <Segmented
            label="Mode"
            value={s.mode}
            onChange={(v) => set('mode', v)}
            options={[
              { value: 'format', label: 'Format' },
              { value: 'minify', label: 'Minify' },
            ]}
          />
        </Option>
        {s.mode === 'format' && (
          <>
            <Option label="Indent">
              <Segmented
                label="Indent"
                value={s.indent}
                onChange={(v) => set('indent', v)}
                options={[
                  { value: '2', label: '2' },
                  { value: '4', label: '4' },
                  { value: 'tab', label: 'Tab' },
                ]}
              />
            </Option>
            <Option label="Attributes" htmlFor="xf-attrs" className="w-44">
              <Select id="xf-attrs" value={s.attributes} onChange={(e) => set('attributes', e.target.value as AttributeLayout)} className="h-8 py-1 text-[13px]">
                <option value="inline">On the tag line</option>
                <option value="auto">Wrap long tags</option>
                <option value="multiline">One per line</option>
              </Select>
            </Option>
            <Option label="Empty elements" htmlFor="xf-empty" className="w-40">
              <Select id="xf-empty" value={s.emptyElements} onChange={(e) => set('emptyElements', e.target.value as EmptyElementStyle)} className="h-8 py-1 text-[13px]">
                <option value="keep">Keep as written</option>
                <option value="collapse">{'Collapse to <a/>'}</option>
                <option value="expand">{'Expand to <a></a>'}</option>
              </Select>
            </Option>
            <Switch label="Double-quote attributes" checked={s.doubleQuotes} onChange={(v) => set('doubleQuotes', v)} className="h-8" />
          </>
        )}
        <Switch label="Remove comments" checked={s.removeComments} onChange={(v) => set('removeComments', v)} className="h-8" />
      </ToolBar>

      {result && (
        <div
          role={error ? 'alert' : 'status'}
          className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3', error ? 'bg-danger-soft' : 'bg-success-soft')}
        >
          <div className="flex min-w-0 items-start gap-2">
            {error ? (
              <CircleX size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            ) : (
              <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-fg">{error ? 'Not well-formed XML' : 'Well-formed XML'}</p>
              <p className="mt-0.5 text-[13px] break-words text-fg-secondary">
                {error
                  ? `${error.message}${error.line !== undefined ? ` (line ${error.line}, column ${error.column ?? 1})` : ''}`
                  : `Root element <${stats?.root ?? '?'}>. Entities are never expanded and nothing external is loaded.`}
              </p>
            </div>
          </div>
          {error?.line !== undefined && (
            <Button size="sm" icon={Crosshair} onClick={() => editor.reveal(error.line, error.column)}>
              Go to error
            </Button>
          )}
        </div>
      )}

      <SplitPanes>
        <EditorPanel code
          title="XML"
          value={input}
          onChange={setInput}
          language="xml"
          placeholder="Paste XML to format, minify or validate…"
          sample={SAMPLE}
          fileAccept=".xml,.xsd,.xsl,.xslt,.svg,.rss,.atom,.plist,.config,.csproj,.xaml,text/xml,application/xml,text/plain"
          invalid={Boolean(error)}
          height="480px"
          extensions={markers}
          onReady={editor.onReady}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <EditorPanel
          title={s.mode === 'minify' ? 'Minified XML' : 'Formatted XML'}
          value={output}
          language="xml"
          downloadName={s.mode === 'minify' ? 'document.min.xml' : 'document.xml'}
          downloadType="application/xml"
          placeholder={error ? 'Fix the error to see the result' : 'The result appears here'}
          height="480px"
          lineWrapping={s.mode === 'minify'}
          footer={
            output ? (
              <TextStats
                text={output}
                extra={
                  inBytes > 0 ? (
                    <span>
                      {outBytes <= inBytes ? `${Math.round((1 - outBytes / inBytes) * 100)}% smaller` : `${Math.round((outBytes / inBytes - 1) * 100)}% larger`}
                    </span>
                  ) : undefined
                }
              />
            ) : undefined
          }
        />
      </SplitPanes>

      {stats && (
        <Panel title="Document statistics">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Elements" value={formatNumber(stats.elements)} />
            <Stat label="Attributes" value={formatNumber(stats.attributes)} />
            <Stat label="Max depth" value={formatNumber(stats.maxDepth)} />
            <Stat label="Namespaces" value={formatNumber(stats.namespaces)} />
            <Stat label="Text nodes" value={formatNumber(stats.textNodes)} />
            <Stat label="Comments" value={formatNumber(stats.comments)} />
            <Stat label="CDATA" value={formatNumber(stats.cdata)} />
            <Stat label="Size" value={formatBytes(inBytes)} />
          </div>
          {(stats.doctype || stats.declaration || stats.processingInstructions > 0) && (
            <p className="mt-3 text-[12.5px] text-fg-muted">
              {[
                stats.declaration && 'XML declaration',
                stats.doctype && 'DOCTYPE (kept as written; entities are not resolved)',
                stats.processingInstructions > 0 && `${formatNumber(stats.processingInstructions)} processing instruction${stats.processingInstructions === 1 ? '' : 's'}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </Panel>
      )}
    </ToolStack>
  );
}
