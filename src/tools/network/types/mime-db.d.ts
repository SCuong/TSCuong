declare module 'mime-db' {
  interface MimeDbEntry {
    source?: 'iana' | 'apache' | 'nginx';
    charset?: string;
    compressible?: boolean;
    extensions?: string[];
  }
  const db: Record<string, MimeDbEntry>;
  export default db;
}
