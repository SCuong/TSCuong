/* Runs only in the service worker. Shared PDF bytes are staged in OPFS, never sent to a server. */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== '/read/share' || event.request.method !== 'POST') return;
  event.respondWith(
    (async () => {
      let folder, id;
      try {
        const data = await event.request.formData();
        const file = data.get('pdf');
        if (!(file instanceof File) || file.size === 0 || file.size > 512 * 1024 * 1024)
          return Response.redirect(new URL('/read?shareError=1', self.location.origin).href, 303);
        folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('reader-incoming', { create: true });
        // An incoming share is temporary: clean stale shares after a day.
        for await (const [name, entry] of folder.entries()) {
          if (entry.kind === 'file' && Date.now() - (await entry.getFile()).lastModified > 86400000)
            await folder.removeEntry(name);
        }
        id = crypto.randomUUID();
        const output = await (await folder.getFileHandle(id + '.pdf', { create: true })).createWritable();
        await output.write(file);
        await output.close();
        const meta = await (await folder.getFileHandle(id + '.json', { create: true })).createWritable();
        await meta.write(JSON.stringify({ name: file.name }));
        await meta.close();
        return Response.redirect(new URL('/read?share=' + id, self.location.origin).href, 303);
      } catch {
        if (folder && id) {
          await folder.removeEntry(id + '.pdf').catch(() => {});
          await folder.removeEntry(id + '.json').catch(() => {});
        }
        return Response.redirect(new URL('/read?shareError=1', self.location.origin).href, 303);
      }
    })(),
  );
});
