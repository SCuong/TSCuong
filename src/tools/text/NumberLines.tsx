import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Input, NumberInput, Select, Switch } from '@/components/ui/Field';
import { useToolState } from '@/lib/hooks';
import { DEFAULT_NUMBER_OPTIONS, numberLines, type NumberOptions } from './lib/lines';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'number-lines';
const SAMPLE = 'Preheat the oven to 180 °C.\nMix flour, sugar and butter.\n\nAdd the eggs one at a time.\nBake for 25 minutes.';

interface Settings {
  start: number | '';
  step: number | '';
  padding: NumberOptions['padding'];
  separator: string;
  skipEmpty: boolean;
}

const DEFAULTS: Settings = { ...DEFAULT_NUMBER_OPTIONS };

export default function NumberLines() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [s, setS] = useToolState<Settings>(ID, 'settings', DEFAULTS);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setS((o) => ({ ...o, [key]: value }));

  const deferred = useDeferredValue(input);
  const output = useMemo(
    () =>
      numberLines(deferred, {
        start: s.start === '' ? 1 : s.start,
        step: s.step === '' ? 1 : s.step,
        padding: s.padding,
        separator: s.separator.replace(/\\t/g, '\t'),
        skipEmpty: s.skipEmpty,
      }),
    [deferred, s],
  );

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Start at" className="w-28">
          <NumberInput value={s.start} onChange={(v) => set('start', v)} aria-label="Start at" />
        </Opt>
        <Opt label="Step" className="w-24">
          <NumberInput value={s.step} onChange={(v) => set('step', v)} aria-label="Step" />
        </Opt>
        <Opt label="Separator" className="w-28">
          <Input value={s.separator} onChange={(e) => set('separator', e.target.value)} mono aria-label="Separator (use \t for a tab)" title="Use \t for a tab" />
        </Opt>
        <Opt label="Padding">
          <Select value={s.padding} onChange={(e) => set('padding', e.target.value as NumberOptions['padding'])} aria-label="Padding" className="w-44">
            <option value="none">None (1, 10)</option>
            <option value="zeros">Zeros (01, 10)</option>
            <option value="spaces">Spaces (␠1, 10)</option>
          </Select>
        </Opt>
        <Switch label="Skip empty lines" checked={s.skipEmpty} onChange={(v) => set('skipEmpty', v)} className="pb-1.5" />
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title="Lines"
          value={input}
          onChange={setInput}
          placeholder="Paste lines to number…"
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="400px"
          lineWrapping={false}
          footer={<TextFooter text={input} />}
        />
        <EditorPanel title="Numbered" value={output} placeholder="Numbered lines appear here" downloadName="numbered.txt" height="400px" lineWrapping={false} />
      </SplitPanes>
    </ToolStack>
  );
}
