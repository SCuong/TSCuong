import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, History, Trash2, Variable, X } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Panel, Badge } from '@/components/ui/Panel';
import { Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { evaluateProgram, formatResult, type AngleMode } from './lib/expression';

const TOOL = 'expression-calculator';
const MAX_HISTORY = 100;
/** Keeps the error marker visible when the error is at the end of the input. */
const NBSP = String.fromCharCode(0xa0);

interface HistoryItem {
  id: string;
  expr: string;
  result: string;
  assigned?: string;
}

const KEYS: Array<{ label: string; insert: string; title?: string }> = [
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: '^', insert: '^', title: 'Power' },
  { label: '%', insert: ' % ', title: 'Remainder (modulo)' },
  { label: '√', insert: 'sqrt(', title: 'Square root' },
  { label: 'π', insert: 'pi' },
  { label: 'e', insert: 'e' },
  { label: 'sin', insert: 'sin(' },
  { label: 'cos', insert: 'cos(' },
  { label: 'tan', insert: 'tan(' },
  { label: 'log', insert: 'log(', title: 'Base-10 logarithm' },
  { label: 'ln', insert: 'ln(', title: 'Natural logarithm' },
  { label: 'abs', insert: 'abs(' },
  { label: 'round', insert: 'round(' },
  { label: 'min', insert: 'min(' },
  { label: 'max', insert: 'max(' },
  { label: 'x!', insert: '!', title: 'Factorial' },
  { label: 'ans', insert: 'ans', title: 'Previous result' },
];

export default function ExpressionCalculator() {
  const [input, setInput] = useState('');
  const [angleMode, setAngleMode] = useToolState<AngleMode>(TOOL, 'angle', 'rad');
  const [history, setHistory] = useToolState<HistoryItem[]>(TOOL, 'history', []);
  const [vars, setVars] = useToolState<Record<string, number>>(TOOL, 'vars', {});
  const inputRef = useRef<HTMLInputElement>(null);

  const live = useMemo(() => {
    if (!input.trim() || input.trim().startsWith('#')) return null;
    const result = evaluateProgram(input, { angleMode }, Object.entries(vars));
    return result.lines[0] ?? null;
  }, [input, angleMode, vars]);

  function commit() {
    if (!live || live.error || live.value === undefined) return;
    const value = live.value;
    const next: Record<string, number> = { ...vars, ans: value };
    if (live.assigned) next[live.assigned] = value;
    setVars(next);
    setHistory((h) =>
      [{ id: crypto.randomUUID(), expr: input.trim(), result: live.formatted!, assigned: live.assigned }, ...h].slice(0, MAX_HISTORY),
    );
    setInput('');
  }

  function insert(text: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = input.slice(0, start) + text + input.slice(end);
    setInput(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + text.length;
      el?.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'ArrowUp' && !input && history[0]) {
      e.preventDefault();
      setInput(history[0].expr);
    } else if (e.key === 'Escape') {
      setInput('');
    }
  }

  const userVars = Object.entries(vars).filter(([k]) => k !== 'ans');
  const error = live?.error;

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Angles</Label>
          <Segmented
            label="Angle unit"
            value={angleMode}
            onChange={setAngleMode}
            options={[
              { value: 'rad', label: 'Radians' },
              { value: 'deg', label: 'Degrees' },
            ]}
          />
        </div>
        <p className="min-w-0 flex-1 basis-64 text-[12.5px] text-fg-muted">
          Operators <code className="font-mono text-fg-secondary">+ − * / ^ %</code> (% is remainder), <code className="font-mono text-fg-secondary">!</code>{' '}
          factorial, implicit multiplication like <code className="font-mono text-fg-secondary">2pi</code>. Assign with{' '}
          <code className="font-mono text-fg-secondary">x = 3</code>; <code className="font-mono text-fg-secondary">ans</code> is the last result.
          Results are double-precision (about 15 significant digits); for exact large integers use the Number Base
          Converter.
        </p>
      </ToolBar>

      <Panel bodyClassName="flex flex-col gap-3">
        <label htmlFor="expr-input" className="sr-only">
          Expression
        </label>
        <div className="flex items-center gap-2">
          <input
            id="expr-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. (1 + sqrt(5)) / 2"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            aria-invalid={error ? true : undefined}
            aria-describedby="expr-result"
            className="lk-field h-12 font-mono text-[17px]"
          />
          <Button variant="primary" size="lg" icon={CornerDownLeft} onClick={commit} disabled={!live || Boolean(error)} className="h-12">
            <span className="hidden sm:inline">Enter</span>
            <span className="sr-only sm:hidden">Evaluate</span>
          </Button>
        </div>

        <div id="expr-result" aria-live="polite" className="min-h-[52px]">
          {error ? (
            <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2">
              <p className="text-[13px] font-medium text-danger">{error.message}</p>
              <p className="mt-1 font-mono text-[13px] break-all whitespace-pre-wrap text-fg">
                {input.slice(0, error.position)}
                <span className="rounded-sm bg-danger-soft text-danger underline decoration-danger decoration-wavy underline-offset-4">
                  {input.slice(error.position, error.position + 1) || NBSP}
                </span>
                {input.slice(error.position + 1)}
              </p>
            </div>
          ) : live?.formatted !== undefined ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
              <output className="min-w-0 font-mono text-[22px] font-semibold break-all tabular-nums text-fg">
                {live.assigned && <span className="text-fg-muted">{live.assigned} = </span>}
                {live.formatted}
              </output>
              <CopyButton value={live.formatted} iconOnly />
            </div>
          ) : (
            <p className="px-1 py-3 text-[13px] text-fg-muted">
              The result appears as you type. Press Enter to keep it in the history.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Insert into the expression">
          {KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              title={k.title}
              onClick={() => insert(k.insert)}
              className="h-8 min-w-10 rounded-md border border-line bg-surface-raised px-2 font-mono text-[13px] text-fg-secondary shadow-card hover:bg-surface-hover hover:text-fg"
            >
              {k.label}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Panel
          title="History"
          actions={
            history.length > 0 && (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setHistory([])}>
                Clear
              </Button>
            )
          }
          bodyClassName="p-0!"
        >
          {history.length === 0 ? (
            <EmptyState icon={History} title="No calculations yet">
              Press Enter to save a result here. Click an entry to edit it again.
            </EmptyState>
          ) : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {history.map((item) => (
                <li key={item.id} className="group flex items-center gap-2 px-4 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInput(item.expr);
                      inputRef.current?.focus();
                    }}
                    className="min-w-0 flex-1 text-left"
                    title="Edit this expression"
                  >
                    <div className="truncate font-mono text-[13px] text-fg-muted">{item.expr}</div>
                    <div className="font-mono text-[15px] font-semibold break-all tabular-nums text-fg">= {item.result}</div>
                  </button>
                  <CopyButton value={item.result} iconOnly />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Variables"
          actions={
            Object.keys(vars).length > 0 && (
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setVars({})}>
                Clear
              </Button>
            )
          }
          bodyClassName={cn(userVars.length === 0 && vars.ans === undefined ? 'p-0!' : 'p-4')}>
          {userVars.length === 0 && vars.ans === undefined ? (
            <EmptyState icon={Variable} title="No variables">
              Assign one with <code className="font-mono">rate = 0.07</code>.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {vars.ans !== undefined && (
                <li className="flex items-center justify-between gap-2 font-mono text-[13px]">
                  <span>
                    <Badge tone="accent">ans</Badge> <span className="text-fg">{formatResult(vars.ans)}</span>
                  </span>
                </li>
              )}
              {userVars.map(([name, value]) => (
                <li key={name} className="flex items-center justify-between gap-2 font-mono text-[13px]">
                  <button type="button" className="min-w-0 truncate text-left" onClick={() => insert(name)} title="Insert">
                    <span className="text-accent-text">{name}</span> <span className="text-fg-muted">=</span>{' '}
                    <span className="text-fg">{formatResult(value)}</span>
                  </button>
                  <IconButton
                    icon={X}
                    size="sm"
                    label={`Remove ${name}`}
                    onClick={() => {
                      const next = { ...vars };
                      delete next[name];
                      setVars(next);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </ToolStack>
  );
}
