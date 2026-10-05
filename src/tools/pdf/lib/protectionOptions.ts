export interface ProtectionJob { bytes: Uint8Array; password?: string; newPassword?: string; ownerPassword?: string }
export function protectionArguments(job: ProtectionJob) {
  const args = ['/input.pdf', '--progress'];
  if (job.password) args.push('--password=' + job.password);
  if (job.newPassword !== undefined) args.push('--encrypt', job.newPassword, job.ownerPassword ?? '', '256', '--');
  else args.push('--decrypt');
  args.push('/output.pdf');
  return args;
}
export function passwordValid(value: string) {
  return value.length >= 8 && new TextEncoder().encode(value).length <= 127 && !value.includes('\0');
}
