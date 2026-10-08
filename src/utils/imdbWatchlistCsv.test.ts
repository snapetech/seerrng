import { describe, expect, it } from 'vitest';
import { parseImdbWatchlistCsv } from './imdbWatchlistCsv';

describe('parseImdbWatchlistCsv', () => {
  it('reads unique IMDb title IDs from the exported Const column', () => {
    const result = parseImdbWatchlistCsv(
      [
        'Const,Created,Title,Description',
        'tt1234567,2026-10-01,"Film, One","A quoted description"',
        'tt7654321,2026-10-02,"Film ""Two""",',
        'tt1234567,2026-10-03,Duplicate,',
      ].join('\r\n')
    );

    expect(result).toEqual({ ids: ['tt1234567', 'tt7654321'], total: 2 });
  });

  it('accepts a UTF-8 BOM and alternate IMDb ID column labels', () => {
    expect(
      parseImdbWatchlistCsv('\uFEFFTitle,IMDb ID\nFilm,tt1234567')
    ).toEqual({ ids: ['tt1234567'], total: 1 });
  });

  it('rejects files without IMDb title IDs and malformed ID values', () => {
    expect(() => parseImdbWatchlistCsv('Name,Value\nA,B')).toThrow(
      'This is not an IMDb title export.'
    );
    expect(() => parseImdbWatchlistCsv('Const,Title\nnot-an-id,Film')).toThrow(
      'The IMDb export contains an invalid title ID.'
    );
    expect(() => parseImdbWatchlistCsv('Const,Title\n"tt1234567,Film')).toThrow(
      'Malformed CSV quoting.'
    );
  });

  it('returns all IDs so the caller can submit bounded batches', () => {
    const rows = Array.from(
      { length: 105 },
      (_, index) =>
        `tt${String(index + 100000).padStart(6, '0')},Title ${index}`
    );
    const result = parseImdbWatchlistCsv(['Const,Title', ...rows].join('\n'));

    expect(result.ids).toHaveLength(105);
    expect(result.total).toBe(105);
  });
});
