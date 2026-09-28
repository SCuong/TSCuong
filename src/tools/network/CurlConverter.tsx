import { useMemo } from 'react';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Label, Select } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage } from '@/lib/utils';
import { parseCurl, type ParsedCurl } from './lib/curl';
import { CODE_TARGETS, generateCode, type CodeTarget } from './lib/curlCodegen';

const TOOL = 'curl-converter';

const SAMPLES: Array<{ label: string; command: string }> = [
  {
    label: 'JSON POST',
    command: `curl -X POST https://api.example.com/v1/users \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer <token>' \\
  -d '{"name": "Ada Lovelace", "email": "ada@example.com", "roles": ["admin"]}'`,
  },
  {
    label: 'File upload',
    command: `curl https://api.example.com/v1/files \\
  -u 'ada:correct horse' \\
  -F 'title=Quarterly report' \\
  -F 'file=@report.pdf;type=application/pdf'`,
  },
  {
    label: 'Browser (bash)',
    command: `curl 'https://shop.example.com/api/cart?currency=EUR' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  -H 'content-type: application/json' \\
  -H 'origin: https://shop.example.com' \\
  -b 'session=4f2a9c; consent=1' \\
  --data-raw '{"sku":"TSHIRT-M","qty":2}' \\
  --compressed`,
  },
  {
    label: 'Windows cmd',
    command: `curl ^"https://api.example.com/search?q=local^&limit=10^" ^
  -H ^"accept: application/json^" ^
  -H ^"x-request-id: 7d1e^" ^
  --compressed`,
  },
  {
    label: 'GET with query',
    command: `curl -G https://api.example.com/v1/search \\
  --data-urlencode 'q=coffee near me' \\
  -d limit=5 -L -m 10`,
  },
];

function Summary({ parsed }: { parsed: ParsedCurl }) {
  const bodyLabel: Record<ParsedCurl['bodyType'], string> = {
    none: 'No body',
    raw: 'Raw text',
    json: 'JSON',
    urlencoded: 'Form (urlencoded)',
    multipart: 'Multipart form',
    binary: 'Binary / file',
  };
  const flags = [
    parsed.auth && 'Basic auth',
    parsed.followRedirects && 'Follow redirects',
    parsed.compressed && 'Compressed',
    parsed.insecure && 'Insecure TLS',
    parsed.maxTime !== undefined && `Timeout ${parsed.maxTime}s`,
    parsed.connectTimeout !== undefined && `Connect timeout ${parsed.connectTimeout}s`,
  ].filter(Boolean) as string[];

  return (
    <Panel title="Parsed request" bodyClassName="flex flex-col gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Badge tone="accent" className="mt-px font-mono">
          {parsed.method}
        </Badge>
        <span className="min-w-0 font-mono text-[12.5px] break-all text-fg">{parsed.url}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge>{bodyLabel[parsed.bodyType]}</Badge>
        {flags.map((f) => (
          <Badge key={f}>{f}</Badge>
        ))}
      </div>
      {parsed.headers.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12.5px]">
            <caption className="sr-only">Headers</caption>
            <tbody className="divide-y divide-line">
              {parsed.headers.map((h, i) => (
                <tr key={i}>
                  <th scope="row" className="w-1/3 px-3 py-1.5 align-top font-mono font-medium text-fg-secondary">
                    {h.name}
                  </th>
                  <td className="px-3 py-1.5 font-mono break-all text-fg">{h.value || <span className="text-fg-muted">(empty)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {parsed.formParts.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {parsed.formParts.map((p, i) => (
            <li key={i} className="font-mono break-all">
              <span className="text-fg-secondary">{p.name}</span>
              <span className="text-fg-muted"> = </span>
              <span className="text-fg">{p.file !== undefined ? `file ${p.file}${p.contentType ? ` (${p.contentType})` : ''}` : (p.value ?? `<${p.valueFile}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function CurlConverter() {
  const [input, setInput] = useToolState(TOOL, 'input', SAMPLES[0].command);
  const [target, setTarget] = useToolState<CodeTarget>(TOOL, 'target', 'fetch');
  const debounced = useDebouncedValue(input, 120);

  const result = useMemo(() => {
    if (!debounced.trim()) return null;
    try {
      const parsed = parseCurl(debounced);
      return { ok: true as const, parsed, code: generateCode(parsed, target) };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error, 'That curl command could not be read.') };
    }
  }, [debounced, target]);

  const targetInfo = CODE_TARGETS.find((t) => t.id === target) ?? CODE_TARGETS[0];
  const ext = { javascript: target === 'node' ? 'mjs' : 'js', python: 'py', go: 'go', php: 'php' }[targetInfo.language];

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-48">
          <Label htmlFor="curl-target">Convert to</Label>
          <Select id="curl-target" value={target} onChange={(e) => setTarget(e.target.value as CodeTarget)}>
            {CODE_TARGETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0">
          <Label>Examples</Label>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setInput(s.command)}
                className="h-8 rounded-md border border-line bg-surface-sunken px-2.5 text-[12.5px] text-fg-secondary hover:border-line-strong hover:text-fg"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </ToolBar>
      {result && !result.ok && <ErrorMessage error={result.error} title="Could not parse the command" />}
      <SplitPanes>
        <EditorPanel
          title="cURL command"
          value={input}
          onChange={setInput}
          language="shell"
          placeholder="curl https://api.example.com -H 'Accept: application/json'"
          invalid={Boolean(result && !result.ok)}
          height="420px"
          footer={<span>Bash, zsh, Windows cmd (^) and PowerShell (`) continuations are supported.</span>}
        />
        <EditorPanel
          title={targetInfo.label}
          value={result?.ok ? result.code : ''}
          language={targetInfo.language}
          placeholder="Generated code appears here"
          downloadName={`request.${ext}`}
          height="420px"
        />
      </SplitPanes>
      {result?.ok && result.parsed.warnings.length > 0 && (
        <Alert tone="warning" title={result.parsed.warnings.length === 1 ? '1 note about this command' : `${result.parsed.warnings.length} notes about this command`}>
          <ul className="list-disc space-y-0.5 pl-4">
            {result.parsed.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}
      {result?.ok && <Summary parsed={result.parsed} />}
    </ToolStack>
  );
}
