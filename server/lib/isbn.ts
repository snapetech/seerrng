export const normalizeIsbn = (isbn?: string): string | undefined =>
  isbn?.replace(/[^0-9X]/gi, '').toUpperCase();

export const isValidIsbn10 = (isbn: string): boolean => {
  if (!/^\d{9}[\dX]$/.test(isbn)) {
    return false;
  }

  const sum = isbn
    .split('')
    .reduce(
      (total, digit, index) =>
        total + (digit === 'X' ? 10 : Number(digit)) * (10 - index),
      0
    );

  return sum % 11 === 0;
};

export const isValidIsbn13 = (isbn: string): boolean => {
  if (!/^\d{13}$/.test(isbn)) {
    return false;
  }

  const sum = isbn
    .slice(0, 12)
    .split('')
    .reduce(
      (total, digit, index) =>
        total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0
    );
  const checkDigit = (10 - (sum % 10)) % 10;

  return checkDigit === Number(isbn[12]);
};

export const convertIsbn10To13 = (isbn: string): string | undefined => {
  if (!isValidIsbn10(isbn)) {
    return undefined;
  }

  const body = `978${isbn.slice(0, 9)}`;
  const sum = body
    .split('')
    .reduce(
      (total, digit, index) =>
        total + Number(digit) * (index % 2 === 0 ? 1 : 3),
      0
    );
  const checkDigit = (10 - (sum % 10)) % 10;

  return `${body}${checkDigit}`;
};

export const normalizeValidIsbn = (isbn?: string): string | undefined => {
  const normalized = normalizeIsbn(isbn);

  if (!normalized) {
    return undefined;
  }

  if (normalized.length === 13 && isValidIsbn13(normalized)) {
    return normalized;
  }

  if (normalized.length === 10) {
    return convertIsbn10To13(normalized);
  }

  return undefined;
};
