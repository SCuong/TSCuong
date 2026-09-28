import { useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, RotateCw, ShieldCheck, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Panel';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { buildPreviewDocument } from './lib/preview';

const TOOL = 'html-preview';

const SAMPLE = {
  html: `<main class="card">
  <h1>Hello, preview 👋</h1>
  <p>Edit the HTML, CSS and JavaScript tabs. The preview updates as you type.</p>
  <button id="count">Clicked 0 times</button>
</main>`,
  css: `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: linear-gradient(135deg, #e0e7ff, #fce7f3);
}
.card {
  max-width: 420px;
  margin: 24px;
  padding: 28px;
  border-radius: 16px;
  background: white;
  box-shadow: 0 10px 30px -10px rgb(0 0 0 / 0.25);
}
button {
  padding: 10px 16px;
  border: 0;
  border-radius: 10px;
  background: #4f46e5;
  color: white;
  font: inherit;
  cursor: pointer;
}`,
  js: `let clicks = 0;
const button = document.getElementById('count');
button.addEventListener('click', () => {
  clicks++;
  button.textContent = \`Clicked \${clicks} time\${clicks === 1 ? '' : 's'}\`;
  console.log('clicks:', clicks);
});`,
};

type Tab = 'html' | 'css' | 'js';
type Width = 'full' | '1024' | '768' | '375';

interface LogLine {
  id: number;
  level: string;
  text: string;
}

export default function HtmlPreview() {
  const [html, setHtml] = useToolState(TOOL, 'html', SAMPLE.html);
  const [css, setCss] = useToolState(TOOL, 'css', SAMPLE.css);
  const [js, setJs] = useToolState(TOOL, 'js', SAMPLE.js);
  const [tab, setTab] = useState<Tab>('html');
  const [width, setWidth] = useToolState<Width>(TOOL, 'width', 'full');
  // Scripts are opt-in per visit and never remembered.
  const [runScripts, setRunScripts] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useMemo(() => Math.random().toString(36).slice(2), []);
  const seq = useRef(0);

  const dHtml = useDebouncedValue(html, 300);
  const dCss = useDebouncedValue(css, 300);
  const dJs = useDebouncedValue(js, 500);
  const doc = useMemo(() => buildPreviewDocument(dHtml, dCss, dJs, runScripts, token), [dHtml, dCss, dJs, runScripts, token]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { __lk?: string; level?: string; text?: string } | null;
      if (!data || data.__lk !== token || typeof data.text !== 'string') return;
      const line = { id: ++seq.current, level: String(data.level ?? 'log'), text: data.text.slice(0, 2000) };
      setLogs((prev) => [...prev.slice(-199), line]);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [token]);

  const editors: Record<Tab, { value: string; set: (v: string) => void; language: 'html' | 'css' | 'javascript'; title: string }> = {
    html: { value: html, set: setHtml, language: 'html', title: 'HTML (body)' },
    css: { value: css, set: setCss, language: 'css', title: 'CSS' },
    js: { value: js, set: setJs, language: 'javascript', title: 'JavaScript' },
  };
  const current = editors[tab];
  const frameWidth = width === 'full' ? '100%' : `${width}px`;

  return (
    <ToolStack>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Segmented
            label="Editor"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'html', label: 'HTML' },
              { value: 'css', label: 'CSS' },
              { value: 'js', label: 'JavaScript' },
            ]}
          />
          <EditorPanel
            key={tab}
            title={current.title}
            value={current.value}
            onChange={current.set}
            language={current.language}
            sample={SAMPLE[tab]}
            placeholder={`Write ${current.title}…`}
            height="560px"
            footer={
              tab === 'js' && !runScripts ? <span className="text-warning">JavaScript is off. Turn on “Run JavaScript” to execute it.</span> : undefined
            }
          />
        </div>

        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <Segmented
              label="Preview width"
              size="sm"
              value={width}
              onChange={setWidth}
              options={[
                { value: 'full', label: 'Full', icon: Monitor },
                { value: '1024', label: '1024', icon: Monitor, title: 'Laptop, 1024px' },
                { value: '768', label: '768', icon: Tablet, title: 'Tablet, 768px' },
                { value: '375', label: '375', icon: Smartphone, title: 'Phone, 375px' },
              ]}
            />
            <div className="flex items-center gap-2">
              <Switch
                label="Run JavaScript"
                checked={runScripts}
                onChange={(v) => {
                  setRunScripts(v);
                  setLogs([]);
                }}
              />
              <IconButton icon={RotateCw} label="Reload preview" size="sm" onClick={() => { setLogs([]); setReloadKey((k) => k + 1); }} />
            </div>
          </header>
          <div className="lk-checker h-[460px] overflow-auto">
            <iframe
              key={reloadKey}
              ref={frame}
              title="Live preview"
              srcDoc={doc}
              // Never allow-same-origin: the page runs in an opaque origin, isolated from LocalKit.
              sandbox={runScripts ? 'allow-scripts' : ''}
              referrerPolicy="no-referrer"
              className="mx-auto block h-full border-0 bg-white"
              style={{ width: frameWidth, minWidth: width === 'full' ? undefined : frameWidth }}
            />
          </div>
          <div className="border-t border-line">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[12.5px] font-medium text-fg-secondary">Console {logs.length > 0 && <Badge>{logs.length}</Badge>}</span>
              <IconButton icon={Trash2} label="Clear console" size="sm" disabled={!logs.length} onClick={() => setLogs([])} />
            </div>
            <div className="h-24 overflow-auto px-3 pb-2 font-mono text-[12px]" aria-live="polite">
              {!runScripts && <p className="text-fg-muted">Console output appears here when JavaScript is running.</p>}
              {runScripts && logs.length === 0 && <p className="text-fg-muted">No output yet.</p>}
              {logs.map((l) => (
                <div
                  key={l.id}
                  className={cn(
                    'border-b border-line/60 py-0.5 break-all whitespace-pre-wrap',
                    l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-fg',
                  )}
                >
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <div className="flex gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] text-fg-secondary">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
        <p>
          The preview runs in a sandboxed frame with its own isolated origin. JavaScript is off until you turn it on, and even
          then it cannot read LocalKit’s storage, cookies or pages, open pop-ups or dialogs, submit forms or navigate this tab. Loading
          external images, fonts or scripts referenced by your code does contact those servers.
        </p>
      </div>
    </ToolStack>
  );
}
