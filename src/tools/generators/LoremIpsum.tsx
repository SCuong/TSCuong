import { useId, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, NumberInput, Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useToolState } from '@/lib/hooks';
import { formatNumber } from '@/lib/utils';
import { LOREM_LIMITS, countWords, generateLorem, type LoremUnit } from './lib/lorem';
import { OutputPanel, ToolField, clampInt } from './components';

const TOOL = 'lorem-ipsum';

const UNIT_LABEL: Record<LoremUnit, string> = { paragraphs: 'Paragraphs', sentences: 'Sentences', words: 'Words', list: 'List items' };

export default function LoremIpsum() {
  const [unit, setUnit] = useToolState<LoremUnit>(TOOL, 'unit', 'paragraphs');
  const [count, setCount] = useToolState<number | ''>(TOOL, 'count', 3);
  const [start, setStart] = useToolState(TOOL, 'start', true);
  const [html, setHtml] = useToolState(TOOL, 'html', false);
  const [nonce, setNonce] = useState(0);
  const countId = useId();

  const limit = LOREM_LIMITS[unit];
  const n = clampInt(count, 1, limit, 1);
  const text = useMemo(() => {
    void nonce;
    return generateLorem({ unit, count: n, startWithLorem: start, html });
  }, [unit, n, start, html, nonce]);

  const words = countWords(text);
  const plainChars = html ? text.replace(/<[^>]+>/g, '').length : text.length;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Generate</Label>
          <Segmented
            label="Unit"
            value={unit}
            onChange={setUnit}
            options={(Object.keys(UNIT_LABEL) as LoremUnit[]).map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
          />
        </div>
        <ToolField label={`How many (max ${formatNumber(limit)})`} htmlFor={countId} className="w-40">
          <NumberInput id={countId} value={count} onChange={setCount} min={1} max={limit} />
        </ToolField>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1.5">
          <Switch label='Start with "Lorem ipsum…"' checked={start} onChange={setStart} />
          <Switch label="HTML tags" checked={html} onChange={setHtml} />
        </div>
        <Button variant="primary" icon={RefreshCw} onClick={() => setNonce((x) => x + 1)} className="sm:ml-auto">
          Regenerate
        </Button>
      </ToolBar>
      {count !== '' && count > limit && (
        <p className="-mt-1 px-1 text-[13px] text-warning">
          {UNIT_LABEL[unit]} are limited to {formatNumber(limit)}, so {formatNumber(limit)} were generated.
        </p>
      )}
      <OutputPanel
        title={html ? 'HTML' : 'Text'}
        text={text}
        filename={html ? 'lorem-ipsum.html' : 'lorem-ipsum.txt'}
        mime={html ? 'text/html;charset=utf-8' : undefined}
        mono={html}
        height="440px"
        footer={
          <>
            <span className="tabular-nums">{formatNumber(words)} words</span>
            <span className="tabular-nums">{formatNumber(plainChars)} characters</span>
          </>
        }
      />
    </ToolStack>
  );
}
