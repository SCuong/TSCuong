import { useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Segmented } from '@/components/ui/Segmented';
import { Label } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/Button';
import type { AuthConfig, AuthType } from '../lib/model';
import type { Scope } from '../lib/vars';
import { VarInput } from './VarInput';

const TYPES: Array<{ value: AuthType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'bearer', label: 'Bearer' },
  { value: 'basic', label: 'Basic' },
  { value: 'apikey', label: 'API key' },
];

function Row({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <Label htmlFor={id} className="mb-0">
        {label}
      </Label>
      {children}
    </div>
  );
}

function SecretInput({ id, value, onChange, scope, placeholder }: { id: string; value: string; onChange: (v: string) => void; scope: Scope; placeholder?: string }) {
  const [show, setShow] = useState(() => /^\s*\{\{[^{}]+\}\}\s*$/.test(value));
  return (
    <div className="flex min-w-0 items-center gap-1">
      {show ? (
        <VarInput id={id} mono value={value} onChange={onChange} scope={scope} placeholder={placeholder} className="flex-1" />
      ) : (
        <input
          id={id}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          placeholder={placeholder}
          className="lk-field flex-1 font-mono text-[13px]"
        />
      )}
      <IconButton icon={show ? EyeOff : Eye} label={show ? 'Hide value' : 'Show value'} size="sm" onClick={() => setShow((s) => !s)} />
    </div>
  );
}

export function AuthEditor({ auth, onChange, scope }: { auth: AuthConfig; onChange: (auth: AuthConfig) => void; scope: Scope }) {
  const set = (patch: Partial<AuthConfig>) => onChange({ ...auth, ...patch });
  return (
    <div className="flex flex-col gap-4 p-3">
      <Segmented label="Auth type" size="sm" value={auth.type} onChange={(type) => set({ type })} options={TYPES} />
      {auth.type === 'none' && (
        <p className="text-[13px] text-fg-muted">No authorization is added. You can still set an Authorization header yourself in Headers.</p>
      )}
      {auth.type === 'bearer' && (
        <Row label="Token" id="api-auth-token">
          <SecretInput id="api-auth-token" value={auth.token} onChange={(token) => set({ token })} scope={scope} placeholder="Token or {{variable}}" />
        </Row>
      )}
      {auth.type === 'basic' && (
        <>
          <Row label="Username" id="api-auth-user">
            <VarInput id="api-auth-user" mono value={auth.username} onChange={(username) => set({ username })} scope={scope} placeholder="Username" />
          </Row>
          <Row label="Password" id="api-auth-pass">
            <SecretInput id="api-auth-pass" value={auth.password} onChange={(password) => set({ password })} scope={scope} placeholder="Password or {{variable}}" />
          </Row>
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          <Row label="Key name" id="api-auth-keyname">
            <VarInput id="api-auth-keyname" mono value={auth.apiKeyName} onChange={(apiKeyName) => set({ apiKeyName })} scope={scope} placeholder="X-API-Key" />
          </Row>
          <Row label="Value" id="api-auth-keyvalue">
            <SecretInput id="api-auth-keyvalue" value={auth.apiKeyValue} onChange={(apiKeyValue) => set({ apiKeyValue })} scope={scope} placeholder="Key or {{variable}}" />
          </Row>
          <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-3">
            <span className="text-[13px] font-medium text-fg-secondary">Add to</span>
            <Segmented
              label="Add API key to"
              size="sm"
              value={auth.apiKeyIn}
              onChange={(apiKeyIn) => set({ apiKeyIn })}
              options={[
                { value: 'header', label: 'Header' },
                { value: 'query', label: 'Query params' },
              ]}
            />
          </div>
        </>
      )}
      {auth.type !== 'none' && (
        <p className="text-[12.5px] text-fg-muted">
          Tip: store secrets in an environment variable marked secret and write <code className="font-mono">{'{{name}}'}</code> here. History never keeps auth
          settings.
        </p>
      )}
    </div>
  );
}
