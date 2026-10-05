import { protectionArguments, type ProtectionJob } from './protectionOptions';
interface QpdfModule {
  FS: { writeFile(path: string, bytes: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
  callMain(args: string[]): number;
}
const scope = self as unknown as { onmessage: ((event: MessageEvent<ProtectionJob>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
scope.onmessage = async ({ data }) => {
  try {
    scope.postMessage({ progress: null });
    // The upstream glue binds console directly rather than accepting print callbacks.
    // Capture it inside this dedicated worker; never expose password-bearing diagnostics.
    console.log = (line: unknown) => { const fraction = /write progress:\s*(\d+)%/.exec(String(line)); if (fraction) scope.postMessage({ progress: Number(fraction[1]) / 100 }); };
    console.error = () => {};
    const base = new URL('/qpdf/12.4.2/', self.location.origin).href;
    const { default: createModule } = await import(/* @vite-ignore */ base + 'qpdf.js') as { default: (options: unknown) => Promise<QpdfModule> };
    const module = await createModule({ noInitialRun: true, locateFile: () => base + 'qpdf.wasm' });
    module.FS.writeFile('/input.pdf', data.bytes);
    const status = module.callMain(protectionArguments(data));
    if (status !== 0 && status !== 3) throw new Error('Could not process PDF');
    const bytes = module.FS.readFile('/output.pdf').slice();
    module.FS.unlink('/input.pdf'); module.FS.unlink('/output.pdf');
    scope.postMessage({ bytes }, [bytes.buffer]);
  } catch {
    // No engine diagnostics or command arguments leave this worker: they can contain passwords.
    scope.postMessage({ error: true });
  }
};
