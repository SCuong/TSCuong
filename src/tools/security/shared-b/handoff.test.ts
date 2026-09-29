import { describe, expect, it } from 'vitest';
import { clearHandoff, peekHandoff, putHandoff } from './handoff';

describe('handoff', () => {
  it('keeps a value until it is cleared, so StrictMode double renders can read it', () => {
    expect(peekHandoff('jwt-decoder')).toBeNull();
    putHandoff('jwt-decoder', { token: 'a.b.c', publicKey: 'pem' });
    expect(peekHandoff('jwt-decoder')).toEqual({ token: 'a.b.c', publicKey: 'pem' });
    expect(peekHandoff('jwt-decoder')?.token).toBe('a.b.c');
    expect(peekHandoff('jwt-generator')).toBeNull();
    clearHandoff('jwt-decoder');
    expect(peekHandoff('jwt-decoder')).toBeNull();
  });

  it('replaces older values', () => {
    putHandoff('jwt-generator', { alg: 'RS256', privateKey: 'one' });
    putHandoff('jwt-generator', { alg: 'ES256', privateKey: 'two' });
    expect(peekHandoff('jwt-generator')).toEqual({ alg: 'ES256', privateKey: 'two' });
    clearHandoff('jwt-generator');
  });
});
