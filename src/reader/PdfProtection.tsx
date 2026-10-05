import { useState } from 'react';
import { PdfInput } from '@/tools/pdf/components/PdfInput';
import { usePdfFile, type LoadedPdf } from '@/tools/pdf/components/usePdfFile';
import { usePdfJob } from '@/tools/pdf/components/usePdfJob';
import { JobProgress, ResultFiles } from '@/tools/pdf/components/Results';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { outputName, pdfBlob, type OutputFile } from '@/tools/pdf/lib/files';
import { passwordValid, runProtection } from '@/tools/pdf/lib/protection';
import { openPdf } from '@/tools/pdf/lib/pdfjs';
import { docId } from '@/tools/pdf/lib/thumbnails';
import { t } from '@/lib/i18n';
import './editing.css';
export default function PdfProtection() {
  const controller = usePdfFile();
  return <PdfInput controller={controller} title={t('Choose a PDF to protect or unlock')}>{(pdf) => <ProtectionWorkspace key={docId(pdf.doc)} pdf={pdf} />}</PdfInput>;
}
function ProtectionWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState<OutputFile | null>(null);
  const job = usePdfJob();
  async function run(encrypt: boolean) {
    setResult(null);
    const bytes = await job.run(async ({ signal, progress }) => {
      const newPassword = encrypt ? password : undefined;
      const ownerPassword = encrypt ? Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('') : undefined;
      const bytes = await runProtection({ bytes: pdf.bytes, password: pdf.password, newPassword, ownerPassword }, signal, (value) => progress(value, t('Processing PDF protection…')));
      const verified = await openPdf(bytes, { password: newPassword });
      try { if (verified.doc.numPages !== pdf.pageCount) throw new Error(t('The exported PDF could not be verified.')); }
      finally { verified.destroy(); }
      return bytes;
    });
    if (bytes) { setResult({ name: outputName(pdf.file.name, encrypt ? 'protected' : 'unlocked'), data: pdfBlob(bytes), type: 'application/pdf' }); setPassword(''); setConfirmation(''); }
  }
  return <div className="pdf-edit-workspace">
    <p>{pdf.encrypted ? t('This PDF is protected. The password you entered is used only in this tab.') : t('This PDF currently has no password protection.')}</p>
    <p className="pdf-edit-hint">{t('Protect a new copy with AES-256, change its open password, or remove protection using the password you know. Text, images and form fields are preserved. Passwords are never saved by LocalKit.')}</p>
    <label className="pdf-form-field">{t('New PDF password')}<input type="password" autoComplete="new-password" maxLength={127} value={password} disabled={job.running} onChange={(e) => setPassword(e.target.value)} /></label>
    <label className="pdf-form-field">{t('Confirm PDF password')}<input type="password" autoComplete="new-password" maxLength={127} value={confirmation} disabled={job.running} onChange={(e) => setConfirmation(e.target.value)} /></label>
    <p className="pdf-edit-hint">{t('Use at least 8 characters and a strong, unique password. There is no password recovery. Unicode passwords are limited to 127 UTF-8 bytes.')}</p>
    <div className="pdf-edit-toolbar"><Button variant="primary" disabled={!passwordValid(password) || password !== confirmation || job.running} onClick={() => void run(true)}>{t('Export password-protected copy')}</Button>
      {pdf.encrypted && <Button disabled={job.running} onClick={() => void run(false)}>{t('Export unlocked copy')}</Button>}</div>
    <p className="pdf-edit-hint">{t('Changing protection can invalidate existing digital signatures. Your original stays unchanged.')}</p>
    <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
    <ErrorMessage error={job.error ? t('The local protection engine could not process this PDF. Check the password, reload, and try again.') : null} />
    {result && <ResultFiles files={[result]} />}
  </div>;
}
