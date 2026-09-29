import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { CodePanel } from '@/tools/json/shared/CodePanel';
import { looksLikeJson, looksLikeXml, type IndentOption } from './lib/common';
import { ATTRIBUTE_PREFIXES, jsonToXml, TEXT_KEYS, xmlToJson } from './lib/xml';
import { DirectionHint, DirectionSwitch, ErrorPanel, NotesPanel, Option, TextStats, useEditorView, useProblemMarkers } from './shared/ConvertUi';

const TOOL = 'xml-json-converter';
type Direction = 'xml2json' | 'json2xml';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:dc="http://purl.org/dc/elements/1.1/">
  <!-- Two books -->
  <book id="b1" available="true">
    <dc:title>Dune</dc:title>
    <year>1965</year>
    <isbn>0441013597</isbn>
    <tags><tag>sci-fi</tag><tag>classic</tag></tags>
  </book>
  <book id="b2" available="false">
    <dc:title lang="fr">L'Étranger</dc:title>
    <year>1942</year>
    <summary><![CDATA[A novel by <Albert Camus> & more.]]></summary>
  </book>
</library>`;

const SAMPLE_JSON = `{
  "library": {
    "book": [
      { "@_id": "b1", "@_available": true, "title": "Dune", "year": 1965, "tags": { "tag": ["sci-fi", "classic"] } },
      { "@_id": "b2", "@_available": false, "title": { "@_lang": "fr", "#text": "L'Étranger" }, "year": 1942 }
    ]
  }
}`;

interface Settings {
  indent: IndentOption;
  attributes: boolean;
  attributePrefix: string;
  textKey: string;
  parseValues: boolean;
  alwaysArray: boolean;
  stripNamespaces: boolean;
  rootName: string;
  itemName: string;
  declaration: boolean;
}

export default function XmlJsonConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(TOOL, 'direction', 'xml2json');
  const [s, setS] = useToolState<Settings>(TOOL, 'settings', {
    indent: '2',
    attributes: true,
    attributePrefix: '@_',
    textKey: '#text',
    parseValues: true,
    alwaysArray: false,
    stripNamespaces: false,
    rootName: 'root',
    itemName: 'item',
    declaration: true,
  });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));
  const editor = useEditorView();

  const toJson = direction === 'xml2json';
  const deferred = useDeferredValue(input);
  const result = useMemo(() => {
    if (!deferred.trim()) return null;
    return toJson ? xmlToJson(deferred, s) : jsonToXml(deferred, s);
  }, [deferred, toJson, s]);
  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;
  const markers = useProblemMarkers(error);
  const wrongWay = useMemo(() => {
    if (!deferred.trim()) return false;
    return toJson ? !looksLikeXml(deferred) && looksLikeJson(deferred) : looksLikeXml(deferred);
  }, [deferred, toJson]);

  function swap() {
    setInput(output);
    setDirection(toJson ? 'json2xml' : 'xml2json');
  }

  const prefixSelect = (
    <Option label="Attribute prefix" htmlFor="xj-prefix" className="w-32">
      <Select id="xj-prefix" value={s.attributePrefix} onChange={(e) => set('attributePrefix', e.target.value)} className="h-8 py-1 font-mono text-[13px]">
        {ATTRIBUTE_PREFIXES.map((p) => (
          <option key={p} value={p}>
            {p}name
          </option>
        ))}
      </Select>
    </Option>
  );
  const textKeySelect = (
    <Option label="Text key" htmlFor="xj-text" className="w-28">
      <Select id="xj-text" value={s.textKey} onChange={(e) => set('textKey', e.target.value)} className="h-8 py-1 font-mono text-[13px]">
        {TEXT_KEYS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </Select>
    </Option>
  );

  return (
    <ToolStack>
      <ToolBar>
        <DirectionSwitch
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'xml2json', label: 'XML → JSON' },
            { value: 'json2xml', label: 'JSON → XML' },
          ]}
          onSwap={swap}
          canSwap={Boolean(output)}
        />
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
        {toJson ? (
          <>
            {s.attributes && prefixSelect}
            {textKeySelect}
            <Switch label="Attributes" checked={s.attributes} onChange={(v) => set('attributes', v)} className="h-8" />
            <Switch label="Numbers & booleans" checked={s.parseValues} onChange={(v) => set('parseValues', v)} className="h-8" />
            <Switch label="Always use arrays" checked={s.alwaysArray} onChange={(v) => set('alwaysArray', v)} className="h-8" />
            <Switch label="Strip namespace prefixes" checked={s.stripNamespaces} onChange={(v) => set('stripNamespaces', v)} className="h-8" />
          </>
        ) : (
          <>
            <Option label="Root element" htmlFor="xj-root" className="w-32">
              <Input id="xj-root" value={s.rootName} onChange={(e) => set('rootName', e.target.value)} className="h-8 py-1 font-mono text-[13px]" spellCheck={false} />
            </Option>
            <Option label="Array item element" htmlFor="xj-item" className="w-36">
              <Input id="xj-item" value={s.itemName} onChange={(e) => set('itemName', e.target.value)} className="h-8 py-1 font-mono text-[13px]" spellCheck={false} />
            </Option>
            {prefixSelect}
            {textKeySelect}
            <Switch label="XML declaration" checked={s.declaration} onChange={(v) => set('declaration', v)} className="h-8" />
          </>
        )}
      </ToolBar>

      {wrongWay && (
        <DirectionHint actionLabel={toJson ? 'Convert JSON → XML' : 'Convert XML → JSON'} onAction={() => setDirection(toJson ? 'json2xml' : 'xml2json')}>
          {toJson ? 'This input is JSON. Did you mean to convert it to XML?' : 'This input looks like XML. Did you mean to convert it to JSON?'}
        </DirectionHint>
      )}
      <ErrorPanel title={toJson ? 'Invalid XML' : 'Cannot convert this JSON'} error={error} onReveal={() => editor.reveal(error?.line, error?.column)} />
      <NotesPanel notes={result?.ok ? result.warnings : []} />

      <SplitPanes>
        <CodePanel
          title={toJson ? 'XML input' : 'JSON input'}
          value={input}
          onChange={setInput}
          language={toJson ? 'xml' : 'json'}
          placeholder={toJson ? 'Paste XML…' : 'Paste JSON…'}
          sample={toJson ? SAMPLE_XML : SAMPLE_JSON}
          fileAccept={toJson ? '.xml,.svg,.rss,.atom,.plist,.config,text/xml,application/xml,text/plain' : '.json,application/json,text/plain'}
          invalid={Boolean(error)}
          height="480px"
          extensions={markers}
          onReady={editor.onReady}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <EditorPanel
          title={toJson ? 'JSON' : 'XML'}
          value={output}
          language={toJson ? 'json' : 'xml'}
          downloadName={toJson ? 'data.json' : 'data.xml'}
          downloadType={toJson ? 'application/json' : 'application/xml'}
          placeholder={toJson ? 'JSON appears here' : 'XML appears here'}
          height="480px"
          lineWrapping={false}
          footer={output ? <TextStats text={output} /> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
