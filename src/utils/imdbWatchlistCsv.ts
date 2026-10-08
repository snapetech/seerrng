export const IMDB_CSV_IMPORT_BATCH_SIZE = 100;

const parseCsv = (input: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error('Malformed CSV quoting.');
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      record.push(field);
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
      field = '';
      if (character === '\r' && input[index + 1] === '\n') index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('Malformed CSV quoting.');
  record.push(field);
  if (record.some((value) => value.length > 0)) records.push(record);
  return records;
};

export const parseImdbWatchlistCsv = (
  input: string
): { ids: string[]; total: number } => {
  const records = parseCsv(input.replace(/^\uFEFF/, ''));
  const headerIndex = records.findIndex((record) =>
    record.some((cell) =>
      ['const', 'imdb id', 'title id'].includes(cell.trim().toLowerCase())
    )
  );
  if (headerIndex < 0) throw new Error('This is not an IMDb title export.');

  const idColumn = records[headerIndex]!.findIndex((cell) =>
    ['const', 'imdb id', 'title id'].includes(cell.trim().toLowerCase())
  );
  const uniqueIds = new Set<string>();
  for (const record of records.slice(headerIndex + 1)) {
    const id = record[idColumn]?.trim() ?? '';
    if (!id) continue;
    if (!/^tt[0-9]{5,20}$/.test(id)) {
      throw new Error('The IMDb export contains an invalid title ID.');
    }
    uniqueIds.add(id);
  }

  if (uniqueIds.size === 0) throw new Error('The IMDb export has no titles.');
  const allIds = [...uniqueIds];
  return {
    ids: allIds,
    total: allIds.length,
  };
};
