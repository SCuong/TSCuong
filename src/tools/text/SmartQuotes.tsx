import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Select, Switch } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { countTypographic, DEFAULT_SMART_OPTIONS, toSmart, toStraight, type SmartOptions } from './lib/quotes';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'smart-quotes';
const SAMPLE_STRAIGHT = `"Don't worry," she said -- "it's only the '90s... isn't it?"
He replied: 'Rock 'n' roll never dies' --- and left.`;
const SAMPLE_CURLY = `“Don’t worry,” she said – “it’s only the ’90s… isn’t it?”
He replied: ‘Rock ’n’ roll never dies’ — and left.`;

type Direction = 'smart' | 'straight';

export default function SmartQuotes() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [direction, setDirection] = useToolState<Direction>(ID, 'direction', 'smart');
  const [o, setO] = useToolState<SmartOptions>(ID, 'options', DEFAULT_SMART_OPTIONS);
  const set = <K extends keyof SmartOptions>(key: K, value: SmartOptions[K]) => setO((prev) => ({ ...prev, [key]: value }));

  const deferred = useDeferredValue(input);
  const output = useMemo(() => (direction === 'smart' ? toSmart(deferred, o) : toStraight(deferred, o)), [deferred, direction, o]);
  const typographic = countTypographic(direction === 'smart' ? output : deferred);

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Convert">
          <Segmented
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'smart', label: 'Straight → curly' },
              { value: 'straight', label: 'Curly → straight' },
            ]}
          />
        </Opt>
        <Opt label="Dashes">
          <Select value={o.dashes} onChange={(e) => set('dashes', e.target.value as SmartOptions['dashes'])} aria-label="Dashes" className="w-56">
            <option value="oldschool">--- ↔ — (em), -- ↔ – (en)</option>
            <option value="em">-- ↔ — (em dash)</option>
            <option value="off">Leave dashes alone</option>
          </Select>
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label="Quotes & apostrophes" checked={o.quotes} onChange={(v) => set('quotes', v)} />
          <Switch label="Ellipsis (... ↔ …)" checked={o.ellipsis} onChange={(v) => set('ellipsis', v)} />
        </div>
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Input"
          value={input}
          onChange={setInput}
          placeholder={direction === 'smart' ? 'Paste text with "straight" quotes…' : 'Paste text with “curly” quotes…'}
          sample={direction === 'smart' ? SAMPLE_STRAIGHT : SAMPLE_CURLY}
          fileAccept={TEXT_FILE_ACCEPT}
          height="360px"
          footer={<TextFooter text={input} />}
        />
        <EditorPanel
          title="Result"
          value={output}
          placeholder="Converted text appears here"
          downloadName="text.txt"
          height="360px"
          footer={input ? <span>{direction === 'smart' ? `${pluralize(typographic, 'typographic mark')} in the result` : `${pluralize(typographic, 'typographic mark')} replaced`}</span> : undefined}
        />
      </SplitPanes>
    </ToolStack>
  );
}
