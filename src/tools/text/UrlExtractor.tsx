import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { DEFAULT_URL_OPTIONS, extractUrls, findUrls, urlHost, type UrlExtractOptions } from './lib/extract';
import { TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'url-extractor';
const SAMPLE = `Check the docs at https://developer.mozilla.org/en-US/docs/Web/API/URL (great reference).
Mirror: ftp://ftp.example.org/pub/files.zip, or visit www.example.com/about.
Wikipedia: https://en.wikipedia.org/wiki/Punycode_(encoding) and again https://developer.mozilla.org/en-US/docs/Web/API/URL.
<a href="https://github.com/features?tab=security#top">GitHub</a>`;

export default function UrlExtractor() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [o, setO] = useToolState<UrlExtractOptions>(ID, 'options', DEFAULT_URL_OPTIONS);
  const set = <K extends keyof UrlExtractOptions>(key: K, value: UrlExtractOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));
  const setProto = (key: keyof UrlExtractOptions['protocols'], value: boolean) =>
    setO((prev) => ({ ...prev, protocols: { ...prev.protocols, [key]: value } }));

  const deferred = useDeferredValue(input);
  const urls = useMemo(() => extractUrls(deferred, o), [deferred, o]);
  const found = useMemo(() => findUrls(deferred).length, [deferred]);
  const hosts = useMemo(() => new Set(urls.map(urlHost).filter(Boolean)).size, [urls]);

  return (
    <ToolStack>
      <ToolBar>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-1">
          <Switch label="http / https" checked={o.protocols.http} onChange={(v) => setProto('http', v)} />
          <Switch label="ftp" checked={o.protocols.ftp} onChange={(v) => setProto('ftp', v)} />
          <Switch label="www. links" checked={o.protocols.www} onChange={(v) => setProto('www', v)} />
          <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
          <Switch label="Remove duplicates" checked={o.dedupe} onChange={(v) => set('dedupe', v)} />
          <Switch label="Sort A → Z" checked={o.sort} onChange={(v) => set('sort', v)} />
          <Switch label="Add https:// to www." checked={o.addProtocol} onChange={(v) => set('addProtocol', v)} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Text, HTML or Markdown"
          value={input}
          onChange={setInput}
          placeholder="Paste anything that contains links…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="420px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="URLs"
          value={urls.join('\n')}
          placeholder={input ? 'No links found' : 'Extracted links appear here, one per line'}
          downloadName="urls.txt"
          height="420px"
          lineWrapping={false}
          footer={
            input ? (
              <>
                <span>{pluralize(urls.length, 'URL')}</span>
                <span>{pluralize(hosts, 'host')}</span>
                {found > urls.length && <span>{found - urls.length} filtered or duplicate</span>}
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
