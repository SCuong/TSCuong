import { useDeferredValue, useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { Alert } from '@/components/ui/Alert';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { allShifts, rotate } from './lib/rot';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from '../text/components/shared';
import { OutputPanel } from '../text/components/OutputPanel';
import { useTask } from '../text/components/useTask';
import { t } from '@/lib/i18n';

const ID = 'rot13-caesar';
const SAMPLE = 'Why did the chicken cross the road? Gb trg gb gur bgure fvqr!';

type Algo = 'caesar' | 'rot47';

export default function RotCipher() {
  const [input, setInput] = useToolState(ID, 'input', '');
  const [algo, setAlgo] = useToolState<Algo>(ID, 'algo', 'caesar');
  const [shift, setShift] = useToolState(ID, 'shift', 13);
  const [decode, setDecode] = useToolState(ID, 'decode', false);
  const [digits, setDigits] = useToolState(ID, 'digits', false);
  const [bruteForce, setBruteForce] = useToolState(ID, 'bruteForce', false);

  const deferred = useDeferredValue(input);
  const task = useTask('rotate', rotate, deferred ? [deferred, algo, shift, decode, digits] : null, { size: deferred.length });
  const output = task.value ?? '';
  const shifts = useMemo(() => (bruteForce && algo === 'caesar' && deferred ? allShifts(deferred.slice(0, 300)) : []), [bruteForce, algo, deferred]);

  return (
    <ToolStack>
      <Alert tone="warning" title={t('Obfuscation, not security')}>
        {t('ROT13, Caesar and ROT47 hide text from a casual glance (spoilers, puzzle answers). Anyone can reverse them in seconds, so never use them to protect passwords or private data.')}
      </Alert>
      <ToolBar>
        <Opt label={t('Cipher')}>
          <Segmented
            label={t('Cipher')}
            value={algo}
            onChange={setAlgo}
            options={[
              { value: 'caesar', label: t('ROT13 / Caesar') },
              { value: 'rot47', label: 'ROT47' },
            ]}
          />
        </Opt>
        {algo === 'caesar' ? (
          <>
            <div className="min-w-56 flex-1 sm:max-w-sm">
              <label htmlFor="rot-shift" className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-fg-secondary">
                <span>Shift</span>
                <span className="font-mono text-fg">
                  {shift}
                  {shift === 13 && <span className="ml-1.5 text-[12px] text-accent-text">ROT13</span>}
                </span>
              </label>
              <input
                id="rot-shift"
                type="range"
                min={1}
                max={25}
                value={shift}
                onChange={(e) => setShift(Number(e.target.value))}
                className="lk-range"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
              <Switch label={t('Decode (shift back)')} checked={decode} onChange={setDecode} />
              <Switch label={shift === 13 ? t('Rotate digits (ROT18)') : t('Rotate digits too')} checked={digits} onChange={setDigits} />
              <Switch label={t('Show all 25 shifts')} checked={bruteForce} onChange={setBruteForce} />
            </div>
          </>
        ) : (
          <p className="pb-2 text-[12.5px] text-fg-muted">{t('ROT47 rotates every printable ASCII character (letters, digits and symbols). Applying it twice restores the text.')}</p>
        )}
      </ToolBar>
      <SplitPanes>
        <EditorPanel
          title={t('Input')}
          value={input}
          onChange={setInput}
          placeholder={t('Text to rotate…')}
          sample={SAMPLE}
          fileAccept={TEXT_FILE_ACCEPT}
          height="280px"
          footer={<TextFooter text={input} />}
        />
        <OutputPanel
          title={t('Output')}
          value={output}
          placeholder={t('Result appears here')}
          downloadName="rotated.txt"
          height="280px"
          busy={task.pending}
          footer={<TextFooter text={output} />}
        />
      </SplitPanes>
      {shifts.length > 0 && (
        <Panel title={t('All shifts')} description={t('Find the readable line to crack an unknown Caesar shift. Click a row to use it.')} bodyClassName="p-0">
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {shifts.map((s) => (
              <li key={s.shift}>
                <button
                  type="button"
                  aria-pressed={!decode && s.shift === shift}
                  onClick={() => {
                    setShift(s.shift);
                    setDecode(false);
                  }}
                  className={cn(
                    'flex w-full items-baseline gap-3 px-4 py-1.5 text-left hover:bg-surface-hover',
                    !decode && s.shift === shift && 'bg-accent-soft',
                  )}
                >
                  <span className="w-8 shrink-0 font-mono text-[12px] text-fg-muted">+{s.shift}</span>
                  <span className="min-w-0 truncate font-mono text-[13px] text-fg">{s.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </ToolStack>
  );
}
