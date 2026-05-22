export const parseBoundedString = (
  value: unknown,
  options: {
    fieldName: string;
    maxLength: number;
    required?: boolean;
  }
): { value: string } | { error: string } => {
  if (typeof value !== 'string') {
    return { error: `${options.fieldName} must be a string.` };
  }

  const trimmed = value.trim();

  if (options.required !== false && !trimmed) {
    return { error: `${options.fieldName} is required.` };
  }

  if (value.length > options.maxLength) {
    return {
      error: `${options.fieldName} must be ${options.maxLength} characters or fewer.`,
    };
  }

  return { value: trimmed };
};

export const parseOptionalBoundedString = (
  value: unknown,
  options: {
    fieldName: string;
    maxLength: number;
  }
): { value: string | undefined } | { error: string } => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  return parseBoundedString(value, { ...options, required: false });
};

export const parseOptionalLanguage = (value: unknown) =>
  parseOptionalBoundedString(value, {
    fieldName: 'Language',
    maxLength: 32,
  });

export const parseOptionalAllowedString = <T extends string>(
  value: unknown,
  options: {
    fieldName: string;
    allowedValues: readonly T[];
    maxLength: number;
  }
): { value: T | undefined } | { error: string } => {
  const parsed = parseOptionalBoundedString(value, options);
  if ('error' in parsed) {
    return parsed;
  }

  if (parsed.value === undefined) {
    return { value: undefined };
  }

  return options.allowedValues.includes(parsed.value as T)
    ? { value: parsed.value as T }
    : { error: `${options.fieldName} must be valid.` };
};

export const parseOptionalQueryBoolean = (
  value: unknown,
  fieldName: string
): { value: boolean | undefined } | { error: string } => {
  if (typeof value === 'boolean') {
    return { value };
  }

  const parsed = parseOptionalAllowedString(value, {
    fieldName,
    allowedValues: ['true', 'false'] as const,
    maxLength: 5,
  });
  if ('error' in parsed) {
    return parsed;
  }

  return {
    value: parsed.value === undefined ? undefined : parsed.value === 'true',
  };
};

export const parseOptionalBodyBoolean = (
  value: unknown,
  fieldName: string
): { value: boolean | undefined } | { error: string } => {
  if (value === undefined || value === null) {
    return { value: undefined };
  }

  return typeof value === 'boolean'
    ? { value }
    : { error: `${fieldName} must be a boolean.` };
};

export const parseOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

export const parseOptionalNonNegativeInteger = (
  value: unknown,
  maxValue = Number.MAX_SAFE_INTEGER
): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= maxValue
    ? value
    : undefined;
