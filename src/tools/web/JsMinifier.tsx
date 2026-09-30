import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Label, Select, Switch } from '@/components/ui/Field';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { formatBytes } from '@/lib/utils';
import { DEFAULT_JS_OPTIONS, type JsMinifyOptions, type SourceType } from './lib/jsMinify';
import { useCodeJob } from './code/codeRunner';
import { JobStatus, SizeSavingsBar, settledOutcome, useByteSize } from './code/shared';

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
  // Older versions stored a `module` flag that defaulted to on; `sourceType` replaces it (default: auto-detect).
  const [stored, setOpts] = useToolState<Partial<JsMinifyOptions>>('js-minifier', 'options', DEFAULT_JS_OPTIONS);
  const opts: JsMinifyOptions = {
    compress: stored.compress ?? DEFAULT_JS_OPTIONS.compress,
    mangle: stored.mangle ?? DEFAULT_JS_OPTIONS.mangle,
    sourceType: stored.sourceType ?? DEFAULT_JS_OPTIONS.sourceType,
    keepLicense: stored.keepLicense ?? DEFAULT_JS_OPTIONS.keepLicense,
    ecma: stored.ecma ?? DEFAULT_JS_OPTIONS.ecma,
  };
  const debounced = useDebouncedValue(input, input.length > 200_000 ? 600 : 300);
  const set = <K extends keyof JsMinifyOptions>(k: K, v: JsMinifyOptions[K]) => setOpts({ ...opts, [k]: v });

  // Terser runs in a worker: large bundles never freeze the page, and a newer edit cancels the old job.
  const key = debounced.trim() ? JSON.stringify([debounced, opts]) : null;
  const job = useCodeJob<'minify-js'>(key, () => ({ kind: 'minify-js', code: debounced, options: opts }));
  const empty = !input.trim();
  const settled = empty ? null : settledOutcome(job.state, job.previous);
  const done = settled?.status === 'done' ? settled.value : null;
  const output = done?.code ?? '';
  const error = settled?.status === 'error' ? settled.error.message : null;
  const inputBytes = useByteSize(input);
  const status = empty ? 'idle' : job.state.status;

  return (
    <ToolStack>
      <ToolBar>
        <Switch label="Compress" checked={opts.compress} onChange={(v) => set('compress', v)} className="h-9" />
        <Switch label="Mangle names" checked={opts.mangle} onChange={(v) => set('mangle', v)} className="h-9" />
        <Switch label="Keep license comments" checked={opts.keepLicense} onChange={(v) => set('keepLicense', v)} className="h-9" />
        <div>
          <Label htmlFor="js-source-type">Source type</Label>
          <Select id="js-source-type" value={opts.sourceType} onChange={(e) => set('sourceType', e.target.value as SourceType)} className="w-auto min-w-40">
            <option value="auto">Auto-detect</option>
            <option value="script">Classic script</option>
            <option value="module">ES module</option>
          </Select>
        </div>
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
          footer={input ? <span>{formatBytes(inputBytes)}</span> : undefined}
        />
        <EditorPanel
          title="Minified"
          value={output}
          language="javascript"
          placeholder={done && !output ? 'Nothing left: the module exports nothing and has no side effects' : 'Minified code appears here'}
          downloadName="script.min.js"
          downloadType="text/javascript"
          height="460px"
          footer={
            status === 'pending' || status === 'cancelled' ? (
              <JobStatus status={status} busyLabel="Minifying…" onCancel={job.cancel} />
            ) : done ? (
              <span>{done.module ? 'Minified as an ES module' : 'Minified as a classic script: top-level names are kept'}</span>
            ) : undefined
          }
        />
      </SplitPanes>
      <p className="text-[12.5px] leading-relaxed text-fg-muted">
        A classic script’s top-level functions and variables are globals that other scripts and HTML attributes may use, so they
        keep their names. In an ES module they are private: unused ones are removed and the rest renamed. Auto-detect treats code
        with import or export statements (or top-level await) as a module. “Output syntax” limits which newer syntax Terser may
        introduce; it does not transpile your code down.
      </p>
    </ToolStack>
  );
}
