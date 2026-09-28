import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input, Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Panel } from '@/components/ui/Panel';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { downloadBlob, errorMessage } from '@/lib/utils';
import { ColorField, RangeField } from '../image/components/controls';
import { BARCODE_FORMATS, validateBarcode, type BarcodeFormat } from './lib/barcode';
import { qrColorWarning } from './lib/content';

type JsBarcodeFn = (element: SVGSVGElement | HTMLCanvasElement, value: string, options: Record<string, unknown>) => void;

let jsBarcode: Promise<JsBarcodeFn> | null = null;
function loadJsBarcode(): Promise<JsBarcodeFn> {
  jsBarcode ??= import('jsbarcode').then((m) => (m.default ?? m) as unknown as JsBarcodeFn);
  return jsBarcode;
}

export default function BarcodeGenerator() {
  const [format, setFormat] = useToolState<BarcodeFormat>('barcode-generator', 'format', 'CODE128');
  const [value, setValue] = useToolState('barcode-generator', 'value', 'LocalKit-2024');
  const [barWidth, setBarWidth] = useToolState('barcode-generator', 'barWidth', 2);
  const [height, setHeight] = useToolState('barcode-generator', 'height', 100);
  const [margin, setMargin] = useToolState('barcode-generator', 'margin', 10);
  const [showText, setShowText] = useToolState('barcode-generator', 'showText', true);
  const [textPosition, setTextPosition] = useToolState<'bottom' | 'top'>('barcode-generator', 'textPosition', 'bottom');
  const [fontSize, setFontSize] = useToolState('barcode-generator', 'fontSize', 18);
  const [fg, setFg] = useToolState('barcode-generator', 'fg', '#000000');
  const [bg, setBg] = useToolState('barcode-generator', 'bg', '#ffffff');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const debounced = useDebouncedValue(value, 120);
  const validation = validateBarcode(format, debounced);
  const info = BARCODE_FORMATS.find((f) => f.value === format)!;

  const options = {
    format,
    width: barWidth,
    height,
    margin,
    displayValue: showText,
    textPosition,
    fontSize,
    lineColor: fg,
    background: bg,
    font: 'monospace',
  };

  useEffect(() => {
    const svg = svgRef.current;
    setRendered(false);
    if (!svg || !validation.ok) return;
    let cancelled = false;
    loadJsBarcode()
      .then((JsBarcode) => {
        if (cancelled) return;
        let valid = true;
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        JsBarcode(svg, validation.value, { ...options, valid: (v: boolean) => (valid = v) });
        if (!valid) {
          setRenderError(`This value can't be encoded as ${info.label}.`);
          return;
        }
        setRenderError(null);
        setRendered(true);
      })
      .catch((e) => !cancelled && setRenderError(errorMessage(e, 'The barcode could not be drawn.')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validation.ok, validation.value, format, barWidth, height, margin, showText, textPosition, fontSize, fg, bg]);

  function svgMarkup(): string {
    const svg = svgRef.current!;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.removeAttribute('class');
    clone.removeAttribute('style');
    return new XMLSerializer().serializeToString(clone);
  }

  async function downloadPng() {
    try {
      const JsBarcode = await loadJsBarcode();
      const canvas = document.createElement('canvas');
      const scale = 2;
      JsBarcode(canvas, validation.value, { ...options, width: barWidth * scale, height: height * scale, margin: margin * scale, fontSize: fontSize * scale });
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'));
      downloadBlob(blob, `barcode-${format.toLowerCase()}.png`);
    } catch (e) {
      toast(errorMessage(e, 'Could not create the PNG.'), 'error');
    }
  }

  const colorWarning = qrColorWarning(fg, bg);
  const error = !validation.ok && debounced ? validation.error! : renderError;

  return (
    <ToolStack>
      <ToolBar>
        <div className="w-full sm:w-56">
          <Label htmlFor="bc-format">Format</Label>
          <Select
            id="bc-format"
            value={format}
            onChange={(e) => {
              const f = e.target.value as BarcodeFormat;
              setFormat(f);
              if (!validateBarcode(f, value).ok) setValue(BARCODE_FORMATS.find((x) => x.value === f)!.example);
            }}
          >
            {BARCODE_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0 flex-1 sm:min-w-64">
          <Label htmlFor="bc-value">Value</Label>
          <Input id="bc-value" value={value} onChange={(e) => setValue(e.target.value)} mono aria-invalid={Boolean(error) || undefined} spellCheck={false} />
        </div>
      </ToolBar>
      <p className="-mt-1 text-[12.5px] text-fg-muted">{info.hint}</p>
      {!debounced && <Alert tone="info">Enter a value to encode.</Alert>}
      <ErrorMessage error={error} title="Can't create this barcode" />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_320px]">
        <Panel
          title="Barcode"
          description={validation.ok && validation.note ? validation.note : undefined}
          actions={
            <>
              <Button size="sm" icon={Download} disabled={!rendered || Boolean(error)} onClick={() => downloadBlob(svgMarkup(), `barcode-${format.toLowerCase()}.svg`, 'image/svg+xml')}>
                SVG
              </Button>
              <Button size="sm" variant="primary" icon={Download} disabled={!rendered || Boolean(error)} onClick={downloadPng}>
                PNG
              </Button>
            </>
          }
        >
          <div className="flex min-h-48 items-center justify-center overflow-x-auto rounded-lg border border-line p-4" style={{ backgroundColor: bg }}>
            <svg ref={svgRef} className={rendered && !error ? 'max-w-full' : 'hidden'} role="img" aria-label={`${info.label} barcode for ${validation.value}`} />
            {(!rendered || error) && <p className="text-[13px]" style={{ color: fg }}>{error ? 'Fix the value to see the barcode.' : ' '}</p>}
          </div>
          {colorWarning && <Alert tone="warning" className="mt-3">{colorWarning.replace('QR', 'barcode')}</Alert>}
        </Panel>
        <Panel title="Options">
          <div className="space-y-3.5">
            <RangeField label="Bar width" value={barWidth} min={1} max={5} onChange={setBarWidth} format={(v) => `${v} px`} />
            <RangeField label="Height" value={height} min={20} max={240} step={5} onChange={setHeight} format={(v) => `${v} px`} />
            <RangeField label="Margin" value={margin} min={0} max={50} onChange={setMargin} format={(v) => `${v} px`} />
            <Checkbox label="Show text" checked={showText} onChange={setShowText} />
            {showText && (
              <>
                <div>
                  <Label>Text position</Label>
                  <Segmented
                    label="Text position"
                    value={textPosition}
                    onChange={setTextPosition}
                    options={[
                      { value: 'bottom', label: 'Below' },
                      { value: 'top', label: 'Above' },
                    ]}
                  />
                </div>
                <RangeField label="Font size" value={fontSize} min={8} max={36} onChange={setFontSize} format={(v) => `${v} px`} />
              </>
            )}
            <div className="flex flex-wrap gap-4">
              <ColorField label="Bars" value={fg} onChange={setFg} />
              <ColorField label="Background" value={bg} onChange={setBg} />
            </div>
          </div>
        </Panel>
      </div>
    </ToolStack>
  );
}
