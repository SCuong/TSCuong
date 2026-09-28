import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Label, Select, Switch } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes } from '@/lib/utils';
import { DEFAULT_JS_OPTIONS, minifyJs, type JsMinifyOptions } from './lib/jsMinify';
import { SizeSavingsBar, useAsyncResult } from './code/shared';

const SAMPLE = `/*! analytics-lite v1.0 | MIT */
import { sendBeacon } from './transport.js';

const DEFAULT_OPTIONS = { endpoint: '/collect', batchSize: 10, debug: false };

export class Tracker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.queue = [];
  }

  // Record an event and flush when the batch is full.
  track(name, properties = {}) {
    const event = { name, properties, timestamp: Date.now() };
    this.queue.push(event);
    if (this.options.debug) {
      console.log('[tracker]', event);
    }
    if (this.queue.length >= this.options.batchSize) {
      this.flush();
    }
  }

  flush() {
    if (this.queue.length === 0) return;
    const payload = JSON.stringify(this.queue.splice(0, this.queue.length));
    sendBeacon(this.options.endpoint, payload);
  }
}
`;

export default function JsMinifier() {
  const [input, setInput] = useToolState('js-minifier', 'input', '');
  const [opts, setOpts] = useToolState<JsMinifyOptions>('js-minifier', 'options', DEFAULT_JS_OPTIONS);
  const debounced = useDebouncedValue(input, 300);
  const set = <K extends keyof JsMinifyOptions>(k: K, v: JsMinifyOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const result = useAsyncResult(debounced.trim() ? JSON.stringify([debounced, opts]) : null, () => minifyJs(debounced, opts));
  const output = input.trim() && result.status === 'done' ? result.value : '';
  const error = input.trim() && result.status === 'error' ? errorMessage(result.error) : null;

  return (
    <ToolStack>
      <ToolBar>
        <Switch label="Compress" checked={opts.compress} onChange={(v) => set('compress', v)} className="h-9" />
        <Switch label="Mangle names" checked={opts.mangle} onChange={(v) => set('mangle', v)} className="h-9" />
        <Switch label="ES module" checked={opts.module} onChange={(v) => set('module', v)} className="h-9" />
        <Switch label="Keep license comments" checked={opts.keepLicense} onChange={(v) => set('keepLicense', v)} className="h-9" />
        <div>
          <Label htmlFor="js-ecma">Output syntax</Label>
          <Select id="js-ecma" value={opts.ecma} onChange={(e) => set('ecma', Number(e.target.value) as JsMinifyOptions['ecma'])} className="w-auto min-w-32">
            <option value={2020}>ES2020</option>
            <option value={2015}>ES2015</option>
            <option value={5}>ES5</option>
          </Select>
        </div>
      </ToolBar>
      <ErrorMessage error={error} title="Syntax error" />
      {output && <SizeSavingsBar before={input} after={output} />}
      <SplitPanes>
        <EditorPanel
          title="JavaScript"
          value={input}
          onChange={setInput}
          language="javascript"
          placeholder="Paste JavaScript here…"
          sample={SAMPLE}
          fileAccept=".js,.mjs,.cjs,text/javascript,text/plain"
          invalid={Boolean(error)}
          height="460px"
          footer={input ? <span>{formatBytes(new Blob([input]).size)}</span> : undefined}
        />
        <EditorPanel
          title="Minified"
          value={output}
          language="javascript"
          placeholder="Minified code appears here"
          downloadName="script.min.js"
          downloadType="text/javascript"
          height="460px"
          footer={result.status === 'pending' && input.trim() ? <Spinner size={13} label="Minifying…" /> : undefined}
        />
      </SplitPanes>
      <p className="text-[12.5px] text-fg-muted">
        “ES module” allows import/export and top-level await and lets Terser rename top-level names. “Output syntax” limits
        which newer syntax Terser may introduce; it does not transpile your code down.
      </p>
    </ToolStack>
  );
}
