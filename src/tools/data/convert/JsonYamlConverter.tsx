import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { CodePanel } from '@/tools/json/shared/CodePanel';
import { looksLikeJson, type IndentOption } from './lib/common';
import { jsonToYaml, yamlToJson, type MultiDocMode } from './lib/yaml';
import { DirectionHint, DirectionSwitch, ErrorPanel, NotesPanel, Option, TextStats, useEditorView, useProblemMarkers } from './shared/ConvertUi';

const TOOL = 'json-yaml-converter';
type Direction = 'yaml2json' | 'json2yaml';

const SAMPLE_YAML = `# Service configuration
name: localkit
version: 1.4.2
country: NO # YAML 1.1 tools read this as false
ports: [8080, 8443]
defaults: &defaults
  LOG_LEVEL: info
  TIMEOUT: 30
services:
  - name: web
    image: nginx:1.27
    env:
      <<: *defaults
      LOG_LEVEL: debug
  - name: worker
    replicas: 3
    command: >
      node worker.js
      --queue jobs
`;

const SAMPLE_JSON = `{
  "name": "localkit",
  "version": "1.4.2",
  "private": true,
  "country": "NO",
  "ports": [8080, 8443],
  "services": [
    { "name": "web", "image": "nginx:1.27", "env": { "LOG_LEVEL": "debug", "TIMEOUT": 30 } },
    { "name": "worker", "replicas": 3, "command": "node worker.js --queue jobs\\n" }
  ]
}`;

interface YamlOut {
  indent: '2' | '4';
  sortKeys: boolean;
  quoteAmbiguous: boolean;
  quoteAll: boolean;
  indentSeq: boolean;
  foldLines: boolean;
  splitDocuments: boolean;
}

interface JsonOut {
  indent: IndentOption;
  yaml11: boolean;
  multiDoc: MultiDocMode;
  cloudFormation: boolean;
}

export default function JsonYamlConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(TOOL, 'direction', 'yaml2json');
  const [j, setJ] = useToolState<JsonOut>(TOOL, 'jsonOptions', { indent: '2', yaml11: false, multiDoc: 'array', cloudFormation: true });
  const [y, setY] = useToolState<YamlOut>(TOOL, 'yamlOptions', {
    indent: '2',
    sortKeys: false,
    quoteAmbiguous: true,
    quoteAll: false,
    indentSeq: true,
    foldLines: false,
    splitDocuments: false,
  });
  const setJo = <K extends keyof JsonOut>(key: K, value: JsonOut[K]) => setJ((o) => ({ ...o, [key]: value }));
  const setYo = <K extends keyof YamlOut>(key: K, value: YamlOut[K]) => setY((o) => ({ ...o, [key]: value }));
  const editor = useEditorView();

  const deferred = useDeferredValue(input);
  const toJson = direction === 'yaml2json';
  const result = useMemo(() => {
    if (!deferred.trim()) return null;
    return toJson ? yamlToJson(deferred, j) : jsonToYaml(deferred, y);
  }, [deferred, toJson, j, y]);

  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;
  const markers = useProblemMarkers(error);
  const inputIsJson = useMemo(() => toJson && looksLikeJson(deferred), [toJson, deferred]);
  const inputIsYaml = !toJson && Boolean(error) && !/^\s*[[{"]/.test(deferred);

  function swap() {
    setInput(output);
    setDirection(toJson ? 'json2yaml' : 'yaml2json');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionSwitch
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'yaml2json', label: 'YAML → JSON' },
            { value: 'json2yaml', label: 'JSON → YAML' },
          ]}
          onSwap={swap}
          canSwap={Boolean(output) && !(toJson && j.multiDoc === 'lines')}
        />
        {toJson ? (
          <>
            <Option label="Indent">
              <Segmented
                label="Indent"
                value={j.indent}
                onChange={(v) => setJo('indent', v)}
                options={[
                  { value: '2', label: '2' },
                  { value: '4', label: '4' },
                  { value: 'tab', label: 'Tab' },
                ]}
              />
            </Option>
            <Option label="Several documents" htmlFor="jy-multi" className="w-44">
              <Select id="jy-multi" value={j.multiDoc} onChange={(e) => setJo('multiDoc', e.target.value as MultiDocMode)} className="h-8 py-1 text-[13px]">
                <option value="array">Combine into an array</option>
                <option value="first">First document only</option>
                <option value="lines">JSON Lines (one per line)</option>
              </Select>
            </Option>
            <Switch label="YAML 1.1 rules (yes/no/on/off are booleans)" checked={j.yaml11} onChange={(v) => setJo('yaml11', v)} className="h-8" />
            <Switch label="CloudFormation tags (!Ref, !Sub…)" checked={j.cloudFormation} onChange={(v) => setJo('cloudFormation', v)} className="h-8" />
          </>
        ) : (
          <>
            <Option label="Indent">
              <Segmented
                label="Indent"
                value={y.indent}
                onChange={(v) => setYo('indent', v)}
                options={[
                  { value: '2', label: '2' },
                  { value: '4', label: '4' },
                ]}
              />
            </Option>
            <Switch label="Sort keys" checked={y.sortKeys} onChange={(v) => setYo('sortKeys', v)} className="h-8" />
            <Switch label="Quote values YAML 1.1 misreads (no, on, 0755…)" checked={y.quoteAmbiguous} onChange={(v) => setYo('quoteAmbiguous', v)} className="h-8" />
            <Switch label="Quote all strings" checked={y.quoteAll} onChange={(v) => setYo('quoteAll', v)} className="h-8" />
            <Switch label="Indent lists" checked={y.indentSeq} onChange={(v) => setYo('indentSeq', v)} className="h-8" />
            <Switch label="Fold long strings" checked={y.foldLines} onChange={(v) => setYo('foldLines', v)} className="h-8" />
            <Switch label="Array items as documents (---)" checked={y.splitDocuments} onChange={(v) => setYo('splitDocuments', v)} className="h-8" />
          </>
        )}
      </ToolBar>

      {inputIsJson && (
        <DirectionHint actionLabel="Convert JSON → YAML" onAction={() => setDirection('json2yaml')}>
          This input is already JSON. Did you mean to convert it to YAML?
        </DirectionHint>
      )}
      {inputIsYaml && (
        <DirectionHint actionLabel="Convert YAML → JSON" onAction={() => setDirection('yaml2json')}>
          This input is not JSON. If it is YAML, switch the direction.
        </DirectionHint>
      )}
      <ErrorPanel title={toJson ? 'Invalid YAML' : 'Invalid JSON'} error={error} onReveal={() => editor.reveal(error?.line, error?.column)} />
      <NotesPanel notes={result?.ok ? result.warnings : []} />

      <SplitPanes>
        <CodePanel
          title={toJson ? 'YAML input' : 'JSON input'}
          value={input}
          onChange={setInput}
          language={toJson ? 'yaml' : 'json'}
          placeholder={toJson ? 'Paste YAML (several documents separated by --- are fine)…' : 'Paste JSON…'}
          sample={toJson ? SAMPLE_YAML : SAMPLE_JSON}
          fileAccept={toJson ? '.yaml,.yml,text/yaml,application/yaml,text/plain' : '.json,application/json,text/plain'}
          invalid={Boolean(error)}
          height="480px"
          extensions={markers}
          onReady={editor.onReady}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <EditorPanel
          title={toJson ? (j.multiDoc === 'lines' ? 'JSON Lines' : 'JSON') : 'YAML'}
          value={output}
          language={toJson ? 'json' : 'yaml'}
          downloadName={toJson ? (j.multiDoc === 'lines' ? 'data.jsonl' : 'data.json') : 'data.yaml'}
          downloadType={toJson ? 'application/json' : 'application/yaml'}
          placeholder={toJson ? 'JSON appears here' : 'YAML appears here'}
          height="480px"
          lineWrapping={false}
          footer={output ? <TextStats text={output} /> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
