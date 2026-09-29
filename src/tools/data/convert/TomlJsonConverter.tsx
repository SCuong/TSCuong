import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { CodePanel } from '@/tools/json/shared/CodePanel';
import { looksLikeJson, type IndentOption } from './lib/common';
import { jsonToToml, tomlToJson, type TomlNullMode } from './lib/toml';
import { DirectionHint, DirectionSwitch, ErrorPanel, NotesPanel, Option, TextStats, useEditorView, useProblemMarkers } from './shared/ConvertUi';

const TOOL = 'toml-json-converter';
type Direction = 'toml2json' | 'json2toml';

const SAMPLE_TOML = `# Project manifest
[package]
name = "localkit"
version = "1.4.2"
authors = ["Ada <ada@example.com>"]
released = 2024-05-27T07:32:00-08:00
license = { name = "MIT", url = "https://opensource.org/license/mit" }

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1.38"

[build]
jobs = 8
ratio = 0.75
max_size = 9_223_372_036_854_775_807

[[bin]]
name = "cli"
path = "src/main.rs"

[[bin]]
name = "worker"
path = "src/worker.rs"
`;

const SAMPLE_JSON = `{
  "title": "Service",
  "owner": { "name": "Ada", "since": "2021-03-14" },
  "server": { "host": "0.0.0.0", "port": 8080, "tls": true, "timeout": 2.5 },
  "features": ["search", "export"],
  "backup": null,
  "mirrors": [
    { "region": "eu", "url": "https://eu.example.com" },
    { "region": "us", "url": "https://us.example.com" }
  ]
}`;

interface Settings {
  indent: IndentOption;
  detectDates: boolean;
  nulls: TomlNullMode;
  sortKeys: boolean;
}

export default function TomlJsonConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(TOOL, 'direction', 'toml2json');
  const [s, setS] = useToolState<Settings>(TOOL, 'settings', { indent: '2', detectDates: true, nulls: 'omit', sortKeys: false });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));
  const editor = useEditorView();

  const toJson = direction === 'toml2json';
  const deferred = useDeferredValue(input);
  const result = useMemo(() => {
    if (!deferred.trim()) return null;
    return toJson ? tomlToJson(deferred, s) : jsonToToml(deferred, s);
  }, [deferred, toJson, s]);
  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;
  const markers = useProblemMarkers(error);
  const jsonInToml = useMemo(() => toJson && Boolean(error) && looksLikeJson(deferred), [toJson, error, deferred]);
  const tomlInJson = !toJson && Boolean(error) && !/^\s*[[{"]/.test(deferred) && /^\s*(?:#|\[|[\w"'-]+\s*=)/.test(deferred);

  function swap() {
    setInput(output);
    setDirection(toJson ? 'json2toml' : 'toml2json');
  }

  return (
    <ToolStack>
      <ToolBar>
        <DirectionSwitch
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'toml2json', label: 'TOML → JSON' },
            { value: 'json2toml', label: 'JSON → TOML' },
          ]}
          onSwap={swap}
          canSwap={Boolean(output)}
        />
        {toJson ? (
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
        ) : (
          <>
            <Option label="JSON null" htmlFor="tj-nulls" className="w-44">
              <Select id="tj-nulls" value={s.nulls} onChange={(e) => set('nulls', e.target.value as TomlNullMode)} className="h-8 py-1 text-[13px]">
                <option value="omit">Leave the key out</option>
                <option value="empty">Write an empty string</option>
              </Select>
            </Option>
            <Switch label="Dates as TOML dates" checked={s.detectDates} onChange={(v) => set('detectDates', v)} className="h-8" />
            <Switch label="Sort keys" checked={s.sortKeys} onChange={(v) => set('sortKeys', v)} className="h-8" />
          </>
        )}
      </ToolBar>

      {!toJson && !result && (
        <p className="px-1 text-[12.5px] text-fg-muted">
          TOML has no null value: JSON nulls are left out (or written as empty strings). Arrays of objects become [[tables]].
        </p>
      )}
      {jsonInToml && (
        <DirectionHint actionLabel="Convert JSON → TOML" onAction={() => setDirection('json2toml')}>
          This input is JSON. Did you mean to convert it to TOML?
        </DirectionHint>
      )}
      {tomlInJson && (
        <DirectionHint actionLabel="Convert TOML → JSON" onAction={() => setDirection('toml2json')}>
          This input looks like TOML. Did you mean to convert it to JSON?
        </DirectionHint>
      )}
      <ErrorPanel title={toJson ? 'Invalid TOML' : 'Cannot convert this JSON'} error={error} onReveal={() => editor.reveal(error?.line, error?.column)} />
      <NotesPanel notes={result?.ok ? result.warnings : []} />

      <SplitPanes>
        <CodePanel
          title={toJson ? 'TOML input' : 'JSON input'}
          value={input}
          onChange={setInput}
          language={toJson ? 'toml' : 'json'}
          placeholder={toJson ? 'Paste TOML (Cargo.toml, pyproject.toml, config.toml…)' : 'Paste JSON…'}
          sample={toJson ? SAMPLE_TOML : SAMPLE_JSON}
          fileAccept={toJson ? '.toml,application/toml,text/plain' : '.json,application/json,text/plain'}
          invalid={Boolean(error)}
          height="480px"
          extensions={markers}
          onReady={editor.onReady}
          footer={input ? <TextStats text={input} /> : undefined}
        />
        <EditorPanel
          title={toJson ? 'JSON' : 'TOML'}
          value={output}
          language={toJson ? 'json' : 'toml'}
          downloadName={toJson ? 'data.json' : 'config.toml'}
          downloadType={toJson ? 'application/json' : 'application/toml'}
          placeholder={toJson ? 'JSON appears here' : 'TOML appears here'}
          height="480px"
          lineWrapping={false}
          footer={output ? <TextStats text={output} /> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
