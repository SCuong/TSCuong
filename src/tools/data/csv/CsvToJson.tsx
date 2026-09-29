import { useMemo } from 'react';
import { SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Label, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes, withExtension } from '@/lib/utils';
import { stringify, tableToJsonValue, type CsvJsonShape, type JsonIndent } from './lib/csvJson';
import { CsvSourcePanel, dataNotes, useCsvSource } from './components/CsvSource';
import { OutputPanel } from './components/OutputPanel';
import { SAMPLE_CSV } from './components/samples';

const TOOL = 'csv-to-json';
const MAX_OUTPUT_CHARS = 60_000_000;

export default function CsvToJson() {
  const source = useCsvSource(TOOL);
  const [shape, setShape] = useToolState<CsvJsonShape>(TOOL, 'shape', 'objects');
  const [typed, setTyped] = useToolState(TOOL, 'typed', true);
  const [nest, setNest] = useToolState(TOOL, 'nest', false);
  const [indent, setIndent] = useToolState<JsonIndent>(TOOL, 'indent', '2');

  const data = source.data;
  const result = useMemo(() => {
    if (!data || !data.table.headers.length) return null;
    try {
      const text = stringify(tableToJsonValue(data.table, { shape, typed, nest }), indent);
      if (text.length > MAX_OUTPUT_CHARS) {
        return { ok: false as const, error: 'The JSON output is too large to show here. Try minified output or split the file.' };
      }
      return { ok: true as const, text, bytes: new Blob([text]).size };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, 'Could not convert this CSV.') };
    }
  }, [data, shape, typed, nest, indent]);

  const output = result?.ok ? result.text : '';
  const notes = data ? dataNotes(data) : [];
  const fileName = data?.fileName ? withExtension(data.fileName, 'json') : 'data.json';

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Output shape</Label>
          <Segmented
            label="Output shape"
            value={shape}
            onChange={setShape}
            options={[
              { value: 'objects', label: 'Objects', title: 'An array with one object per row' },
              { value: 'arrays', label: 'Arrays', title: 'An array of arrays, header first' },
              { value: 'columns', label: 'Columns', title: 'One array per column' },
            ]}
          />
        </div>
        <div>
          <Label>Indent</Label>
          <Segmented
            label="Indent"
            value={indent}
            onChange={setIndent}
            options={[
              { value: '2', label: '2' },
              { value: '4', label: '4' },
              { value: 'tab', label: 'Tab' },
              { value: 'min', label: 'Minify' },
            ]}
          />
        </div>
        <Switch label="Detect numbers, booleans & null" checked={typed} onChange={setTyped} className="h-8" />
        {shape === 'objects' && <Switch label="Nest dotted headers (a.b)" checked={nest} onChange={setNest} className="h-8" />}
      </ToolBar>
      {result && !result.ok && <ErrorMessage error={result.error} title="Conversion failed" />}
      {notes.length > 0 && (
        <Alert tone="warning" title="Input notes">
          <ul className="list-disc pl-4">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}
      <SplitPanes>
        <CsvSourcePanel source={source} sample={SAMPLE_CSV} height="480px" />
        <OutputPanel
          title="JSON"
          value={output}
          language="json"
          downloadName={fileName}
          downloadType="application/json"
          bytes={result?.ok ? result.bytes : undefined}
          placeholder={source.busy ? 'Parsing…' : 'JSON appears here'}
          height="480px"
          footer={
            output ? (
              <>
                <span>
                  {data?.table.rows.length.toLocaleString()} {shape === 'columns' ? 'values per column' : 'records'}
                </span>
                <span>{formatBytes(result?.ok ? result.bytes : 0)}</span>
              </>
            ) : undefined
          }
        />
      </SplitPanes>
    </ToolStack>
  );
}
