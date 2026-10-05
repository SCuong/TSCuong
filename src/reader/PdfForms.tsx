import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Feedback';
import { PdfInput } from '@/tools/pdf/components/PdfInput';
import { usePdfFile, type LoadedPdf } from '@/tools/pdf/components/usePdfFile';
import { JobProgress, ResultFiles } from '@/tools/pdf/components/Results';
import { usePdfJob } from '@/tools/pdf/components/usePdfJob';
import { outputName, pdfBlob, type OutputFile } from '@/tools/pdf/lib/files';
import { docId } from '@/tools/pdf/lib/thumbnails';
import { fingerprint, pdfDrafts } from './storage';
import { supportedWidget, widgetValue, type FormValue, type PdfFormWidget } from './forms';
import { t } from '@/lib/i18n';
import './editing.css';

export default function PdfForms() {
  const controller = usePdfFile();
  return <PdfInput controller={controller} title={t('Choose a PDF form')}>{(pdf) => <FormWorkspace key={docId(pdf.doc)} pdf={pdf} />}</PdfInput>;
}
function FormWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const [widgets, setWidgets] = useState<PdfFormWidget[]>([]);
  const [values, setValues] = useState<Record<string, FormValue>>({});
  const [id, setId] = useState('');
  const [loading, setLoading] = useState(true);
  const [pageNumber, setPage] = useState(1);
  const [scan, setScan] = useState(0);
  const [warning, setWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ values: typeof values; file: OutputFile } | null>(null);
  const [scanCancelled, setScanCancelled] = useState(false);
  const job = usePdfJob();
  const { setError } = job;
  useEffect(() => {
    let alive = true;
    if (scanCancelled) return;
    void (async () => {
      const hash = await fingerprint(pdf.bytes);
      const draft = await pdfDrafts.get(hash).catch(() => { if (alive) setWarning(true); return undefined; });
      const fields: PdfFormWidget[] = [];
      for (let n = 1; n <= pdf.pageCount; n++) {
        if (!alive) return;
        const page = await pdf.doc.getPage(n);
        const annotations = await page.getAnnotations({ intent: 'display' });
        for (const item of annotations) {
          if (typeof item.fieldName === 'string' && typeof item.id === 'string') fields.push({ ...item, page: n } as PdfFormWidget);
        }
        page.cleanup();
        if (alive) setScan(n);
      }
      if (alive) { setWidgets(fields); setId(hash); setValues(draft?.forms ?? {}); setPage(fields[0]?.page ?? 1); setLoading(false); }
    })().catch(() => { if (alive) { setError(t('Could not read the PDF form.')); setLoading(false); } });
    return () => { alive = false; };
  }, [pdf, scanCancelled, setError]);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const passwordNames = new Set(widgets.filter((w) => w.password).map((w) => w.fieldName));
    const safe = Object.fromEntries(Object.entries(values).filter(([name]) => !passwordNames.has(name)));
    setSaving(true);
    void pdfDrafts.patch(id, { forms: safe }).then(() => { if (alive) { setSaving(false); setWarning(false); } }).catch(() => { if (alive) { setSaving(false); setWarning(true); } });
    return () => { alive = false; };
  }, [id, values, widgets]);
  const update = (name: string, value: FormValue) => setValues((old) => ({ ...old, [name]: value }));
  async function exportForm() {
    const snapshot = values;
    const bytes = await job.run(async ({ signal, progress }) => {
      for (const widget of widgets) {
        if (widget.readOnly || !supportedWidget(widget)) continue;
        pdf.doc.annotationStorage.setValue(widget.id, { value: widgetValue(widget, snapshot[widget.fieldName]) });
      }
      progress(null, t('Saving filled form…'));
      const bytes = await pdf.doc.saveDocument();
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return bytes;
    });
    if (bytes) setResult({ values: snapshot, file: { name: outputName(pdf.file.name, 'filled'), data: pdfBlob(bytes), type: 'application/pdf' } });
  }
  const pages = [...new Set(widgets.map((widget) => widget.page))];
  const visible = widgets.filter((widget) => widget.page === pageNumber);
  const names = new Set<string>();
  const unique = visible.filter((widget) => { if (widget.radioButton) return true; if (names.has(widget.fieldName)) return false; names.add(widget.fieldName); return true; });
  return <div className="pdf-edit-workspace">
    <p className="pdf-edit-hint">{t('Fill standard PDF form fields and export an editable copy. Values stay on this device. Password fields are never saved in drafts.')}</p>
    {loading ? <><Spinner label={t('Reading form fields: {page}/{total}', { page: scan, total: pdf.pageCount })} /><Button onClick={() => { setScanCancelled(true); setLoading(false); }}>{t('Cancel')}</Button></> : scanCancelled ? <Button onClick={() => { setLoading(true); setScanCancelled(false); }}>{t('Read form fields again')}</Button> : !widgets.length ? <p role="status">{t('This PDF has no supported interactive form fields. Use Text notes to add visible text to a flat or scanned form. XFA forms require a compatible desktop PDF app.')}</p> : <>
      <label className="pdf-form-field">{t('Form page')}<select value={pageNumber} onChange={(e) => setPage(Number(e.target.value))}>{pages.map((n) => <option key={n} value={n}>{t('Page {index}', { index: n })}</option>)}</select></label>
      <div className="pdf-form-fields">{unique.map((widget) => {
        const label = widget.alternativeText || widget.fieldName;
        const value = values[widget.fieldName] ?? widget.fieldValue ?? '';
        const fieldId = 'pdf-form-' + widget.id;
        if (!supportedWidget(widget)) return <p key={widget.id} className="pdf-edit-hint">{label}: {t('This field requires a desktop PDF app (signature or action button).')}</p>;
        return <div className="pdf-form-field" key={widget.id}>
          {widget.checkBox || widget.radioButton ? <label className="pdf-form-checkbox"><input id={fieldId} type={widget.checkBox ? 'checkbox' : 'radio'} name={widget.radioButton ? widget.fieldName : undefined} checked={Boolean(widgetValue(widget, value))} disabled={widget.readOnly || job.running} onChange={(e) => update(widget.fieldName, widget.radioButton ? widget.buttonValue ?? '' : e.target.checked)} />{label}{widget.radioButton ? ': ' + widget.buttonValue : ''}</label> : <><label htmlFor={fieldId}>{label}{widget.readOnly ? ' (' + t('Read only') + ')' : ''}</label>
            {widget.fieldType === 'Ch' ? <select id={fieldId} multiple={widget.multiSelect} value={widget.multiSelect ? Array.isArray(value) ? value : [String(value)] : Array.isArray(value) ? value[0] : String(value)} disabled={widget.readOnly || job.running} onChange={(e) => update(widget.fieldName, widget.multiSelect ? Array.from(e.target.selectedOptions, (item) => item.value) : e.target.value)}>{!widget.multiSelect && !widget.options!.some((option) => option.exportValue === '') && <option value="">{t('Choose an option')}</option>}{widget.options!.map((option) => <option key={option.exportValue} value={option.exportValue}>{option.displayValue}</option>)}</select> : widget.multiLine ? <textarea id={fieldId} rows={3} maxLength={widget.maxLen || 10000} value={String(value)} disabled={widget.readOnly || job.running} onChange={(e) => update(widget.fieldName, e.target.value)} /> : <input id={fieldId} type={widget.password ? 'password' : 'text'} autoComplete="off" maxLength={widget.maxLen || 10000} value={String(value)} disabled={widget.readOnly || job.running} onChange={(e) => update(widget.fieldName, e.target.value)} />}
          </>}
        </div>;
      })}</div>
      <p role="status" className="pdf-edit-hint">{warning ? t('Edits could not be saved on this device. Export a copy before closing.') : saving ? t('Saving edits on this device…') : t('Form draft saved on this device. Export to keep the filled values in your PDF.')}</p>
      <p className="pdf-edit-hint">{t('Editing can invalidate existing digital signatures. JavaScript actions and automatic calculations are not executed.')}</p>
      <Button variant="primary" disabled={job.running || !widgets.some((w) => !w.readOnly && supportedWidget(w))} onClick={() => void exportForm()}>{t('Export filled copy')}</Button>
    </>}
    <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} /><ErrorMessage error={job.error} />
    {result?.values === values && <ResultFiles files={[result.file]} />}
  </div>;
}
