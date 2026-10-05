import { expect, it } from 'vitest';
import { passwordValid, protectionArguments } from './protectionOptions';
it('selects AES-256 and passes passwords as literal arguments without shell interpolation', () => {
  expect(protectionArguments({ bytes: new Uint8Array(), password: 'known password', newPassword: 'new password', ownerPassword: 'random owner' })).toEqual(['/input.pdf', '--progress', '--password=known password', '--encrypt', 'new password', 'random owner', '256', '--', '/output.pdf']);
});
it('decrypts into a separate file and never overwrites the input', () => {
  const args = protectionArguments({ bytes: new Uint8Array(), password: 'known' });
  expect(args).toContain('--decrypt'); expect(args).not.toContain('--replace-input'); expect(args.at(-1)).toBe('/output.pdf');
});
it('limits Unicode passwords by bytes and rejects empty, short and NUL-containing input', () => {
  expect(passwordValid('secret')).toBe(false); expect(passwordValid('a'.repeat(8))).toBe(true);
  expect(passwordValid('漢'.repeat(43))).toBe(false); expect(passwordValid('strong\0password')).toBe(false);
});
