/** Browser adapter; native integrations can replace it without changing the reader. */
export const readerPlatform = {
  async persist() {
    return navigator.storage?.persist ? navigator.storage.persist() : false;
  },
  async takeSharedFile(id: string): Promise<File> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid share');
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('reader-incoming');
    const handle = await folder.getFileHandle(id + '.pdf');
    const file = await handle.getFile();
    // Filename is metadata, not PDF binary data.
    const meta = await (await folder.getFileHandle(id + '.json')).getFile();
    const { name } = JSON.parse(await meta.text()) as { name: string };
    // OPFS File/Blob snapshots become unreadable after their entry is removed.
    // Materialize the bytes before cleaning the temporary share.
    const bytes = await file.arrayBuffer();
    await folder.removeEntry(id + '.pdf');
    await folder.removeEntry(id + '.json');
    return new File([bytes], name, { type: 'application/pdf' });
  },
  async fullscreen(element: HTMLElement) {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (element.requestFullscreen) await element.requestFullscreen();
  },
};
