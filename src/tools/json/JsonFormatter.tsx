import { useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { ErrorMessage } from '@/components/ui/Alert';
import { Label, Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import { formatJson, formatJsonError, minifyJson, type Indent } from './lib/json';

const SAMPLE = `{"name":"LocalKit","version":"1.0.0","private":true,"tags":["pdf","json","images"],"author":{"name":"You","url":null},"stats":{"tools":100,"uploads":0}}`;

export default function JsonFormatter() {
  const [input, setInput] = useToolState('json-formatter', 'input', '');
  const [mode, setMode] = useToolState<'format' | 'minify'>('json-formatter', 'mode', 'format');
  const [indent, setIndent] = useToolState<Indent>('json-formatter', 'indent', '2');
  const [sortKeys, setSortKeys] = useToolState('json-formatter', 'sort', false);

  const result = useMemo(() => {
    if (!input.trim()) return null;
    return mode === 'minify' ? minifyJson(input) : formatJson(input, indent, sortKeys);
  }, [input, mode, indent, sortKeys]);

  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? formatJsonError(result.error) : null;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Mode</Label>
          <Segmented
            label="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'format', label: 'Format' },
              { value: 'minify', label: 'Minify' },
            ]}
          />
        </div>
        {mode === 'format' && (
          <>
            <div>
              <Label>Indent</Label>
              <Segmented
                label="Indent"
                value={indent}
                onChange={setIndent}
                options={[
                  { value: '2', label: '2 spaces' },
                  { value: '4', label: '4 spaces' },
                  { value: 'tab', label: 'Tab' },
                ]}
              />
            </div>
            <Switch label="Sort keys" checked={sortKeys} onChange={setSortKeys} className="h-8" />
          </>
        )}
      </ToolBar>
      <ErrorMessage error={error} title="Invalid JSON" />
      <SplitPanes>
        <EditorPanel
          title="Input JSON"
          value={input}
          onChange={setInput}
          language="json"
          placeholder="Paste JSON here…"
          sample={SAMPLE}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(error)}
          height="480px"
          footer={input ? <span>{formatBytes(new Blob([input]).size)}</span> : undefined}
        />
        <EditorPanel
          title={mode === 'minify' ? 'Minified' : 'Formatted'}
          value={output}
          language="json"
          downloadName={mode === 'minify' ? 'data.min.json' : 'data.json'}
          downloadType="application/json"
          placeholder="Result appears here"
          height="480px"
          footer={
            output ? (
              <>
                <span className="text-success">Valid JSON</span>
                <span>{formatBytes(new Blob([output]).size)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
