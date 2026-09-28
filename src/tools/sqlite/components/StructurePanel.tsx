import type { ReactNode } from 'react';
import { Key } from 'lucide-react';
import { Badge, KeyValueList, Stat } from '@/components/ui/Panel';
import { formatBytes, formatNumber } from '@/lib/utils';
import type { DbInfo, SchemaObject, TableDetails } from '../lib/protocol';
import { SqlBlock } from './SqlBlock';

function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
        {title}
        {count !== undefined && <span className="font-normal text-fg-muted">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

const th = 'border-b border-line-strong bg-surface-raised px-3 py-2 text-left text-[12px] font-semibold text-fg-secondary whitespace-nowrap';
const td = 'border-b border-line px-3 py-1.5 align-top text-[12.5px] text-fg';

export function StructurePanel({ object, details }: { object: SchemaObject; details: TableDetails | null }) {
  if (object.type === 'index' || object.type === 'trigger' || !details) {
    return (
      <div className="flex flex-col gap-4">
        <KeyValueList
          items={[
            { label: 'Type', value: object.type },
            { label: 'Name', value: object.name },
            { label: 'Table', value: object.tableName },
          ]}
        />
        <Section title="CREATE statement">
          {object.sql ? (
            <SqlBlock sql={object.sql} />
          ) : (
            <p className="text-[13px] text-fg-muted">
              SQLite created this {object.type} automatically (for a UNIQUE or PRIMARY KEY constraint), so it has no CREATE statement.
            </p>
          )}
        </Section>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Section title="Columns" count={details.columns.length}>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>#</th>
                <th className={th}>Name</th>
                <th className={th}>Type</th>
                <th className={th}>PK</th>
                <th className={th}>Not null</th>
                <th className={th}>Default</th>
              </tr>
            </thead>
            <tbody>
              {details.columns.map((c) => (
                <tr key={c.cid}>
                  <td className={`${td} text-fg-muted tabular-nums`}>{c.cid}</td>
                  <td className={`${td} font-mono`}>
                    {c.name}
                    {c.hidden > 1 && <Badge className="ml-1.5">generated</Badge>}
                  </td>
                  <td className={`${td} font-mono text-fg-secondary uppercase`}>{c.type || <span className="text-fg-muted normal-case">any</span>}</td>
                  <td className={td}>
                    {c.pk > 0 && (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <Key size={12} aria-hidden />
                        {details.columns.filter((x) => x.pk > 0).length > 1 ? c.pk : 'Yes'}
                      </span>
                    )}
                  </td>
                  <td className={td}>{c.notNull ? 'Yes' : ''}</td>
                  <td className={`${td} font-mono text-fg-secondary`}>{c.defaultValue ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {details.type === 'table' && (
        <Section title="Foreign keys" count={details.foreignKeys.length}>
          {details.foreignKeys.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No foreign keys.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Column</th>
                    <th className={th}>References</th>
                    <th className={th}>On update</th>
                    <th className={th}>On delete</th>
                  </tr>
                </thead>
                <tbody>
                  {details.foreignKeys.map((f) => (
                    <tr key={`${f.id}-${f.seq}`}>
                      <td className={`${td} font-mono`}>{f.from}</td>
                      <td className={`${td} font-mono`}>
                        {f.table}
                        {f.to ? `(${f.to})` : ' (primary key)'}
                      </td>
                      <td className={td}>{f.onUpdate}</td>
                      <td className={td}>{f.onDelete}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {details.type === 'table' && (
        <Section title="Indexes" count={details.indexes.length}>
          {details.indexes.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No indexes.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Columns</th>
                    <th className={th}>Unique</th>
                    <th className={th}>Origin</th>
                  </tr>
                </thead>
                <tbody>
                  {details.indexes.map((ix) => (
                    <tr key={ix.name}>
                      <td className={`${td} font-mono`}>{ix.name}</td>
                      <td className={`${td} font-mono`}>{ix.columns.join(', ')}</td>
                      <td className={td}>{ix.unique ? 'Yes' : ''}</td>
                      <td className={td}>
                        {ix.origin === 'c' ? 'CREATE INDEX' : ix.origin === 'u' ? 'UNIQUE constraint' : ix.origin === 'pk' ? 'PRIMARY KEY' : ix.origin}
                        {ix.partial && <Badge className="ml-1.5">partial</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {details.triggers.length > 0 && (
        <Section title="Triggers" count={details.triggers.length}>
          <div className="flex flex-col gap-2">
            {details.triggers.map((t) => (
              <div key={t.name}>
                <p className="mb-1 font-mono text-[12.5px] text-fg-secondary">{t.name}</p>
                {t.sql && <SqlBlock sql={t.sql} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="CREATE statement">
        {details.sql ? <SqlBlock sql={details.sql} /> : <p className="text-[13px] text-fg-muted">No CREATE statement.</p>}
      </Section>
    </div>
  );
}

export function InfoPanel({ info, fileName, originalSize }: { info: DbInfo; fileName: string; originalSize: number | null }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Tables" value={formatNumber(info.counts.table, 0)} />
        <Stat label="Views" value={formatNumber(info.counts.view, 0)} />
        <Stat label="Indexes" value={formatNumber(info.counts.index, 0)} />
        <Stat label="Triggers" value={formatNumber(info.counts.trigger, 0)} />
      </div>
      <KeyValueList
        items={[
          { label: 'Name', value: fileName },
          ...(originalSize !== null ? [{ label: 'Original file size', value: `${formatBytes(originalSize)} (${formatNumber(originalSize, 0)} bytes)` }] : []),
          { label: 'Current size', value: `${formatBytes(info.fileSize)} (${formatNumber(info.fileSize, 0)} bytes)` },
          { label: 'Page size', value: `${formatNumber(info.pageSize, 0)} bytes` },
          { label: 'Page count', value: formatNumber(info.pageCount, 0) },
          { label: 'Free pages', value: formatNumber(info.freelistCount, 0) },
          { label: 'Text encoding', value: info.encoding },
          { label: 'user_version', value: String(info.userVersion) },
          { label: 'application_id', value: String(info.applicationId) },
          { label: 'Journal mode', value: info.journalMode },
          { label: 'SQLite engine version', value: info.sqliteVersion },
        ]}
      />
      <p className="text-[12.5px] text-fg-muted">
        The database lives in this tab’s memory (sql.js / WebAssembly). Your original file is never modified.
      </p>
    </div>
  );
}

