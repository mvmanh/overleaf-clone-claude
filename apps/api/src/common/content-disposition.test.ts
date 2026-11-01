import { describe, expect, it } from 'vitest';
import { contentDisposition } from './content-disposition';

describe('contentDisposition', () => {
  it('provides an ASCII fallback and a UTF-8 name', () => {
    expect(contentDisposition('attachment', 'Luận văn "v2".zip')).toBe(
      `attachment; filename="Luan van _v2_.zip"; filename*=UTF-8''Lu%E1%BA%ADn%20v%C4%83n%20%22v2%22.zip`,
    );
  });

  it('cannot inject header parameters', () => {
    expect(contentDisposition('inline', 'a"; evil=1\r\n.pdf')).not.toMatch(/[\r\n]|"; evil/);
  });
});
