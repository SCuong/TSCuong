import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import vi from './vi';
import { setMessagesForTests } from '@/lib/i18n';
import { createToolSearchIndex } from '@/tools/registry';

describe('tool search in Vietnamese', () => {
  let index: ReturnType<typeof createToolSearchIndex>;
  beforeAll(() => {
    setMessagesForTests('vi', vi);
    index = createToolSearchIndex();
  });
  afterAll(() => setMessagesForTests('en', null));

  const top = (query: string) => index.search(query, 5)[0]?.item.id;

  it.each([
    ['gộp pdf', 'pdf-merge'],
    ['gop pdf', 'pdf-merge'],
    ['ghép pdf', 'pdf-merge'],
    ['tách pdf', 'pdf-split'],
    ['nén ảnh', 'image-compress'],
    ['nen anh', 'image-compress'],
    ['giảm dung lượng ảnh', 'image-compress'],
    ['xoay ảnh', 'image-rotate'],
    ['định dạng json', 'json-formatter'],
    ['dinh dang json', 'json-formatter'],
    ['giải mã jwt', 'jwt-decoder'],
    ['csv sang json', 'csv-to-json'],
    ['mã qr', 'qr-generator'],
    ['tạo mật khẩu', 'password-generator'],
    ['đếm từ', 'text-statistics'],
    ['sơ đồ', 'mermaid-studio'],
    ['múi giờ', 'timezone-converter'],
  ])('%s → %s', (query, id) => {
    expect(top(query)).toBe(id);
  });

  it('still finds tools by their English names', () => {
    expect(top('merge pdf')).toBe('pdf-merge');
    expect(top('json formatter')).toBe('json-formatter');
    expect(top('regex')).toBe('regex-tester');
  });
});
