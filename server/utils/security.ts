import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import net from 'net';
import { timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';

const SECRET_KEY_PATTERN =
  /(api[-_]?key|token|secret|password|pass|authorization|authHeader|webhookUrl|accessToken|userToken|botAPI|smtpHost|authUser|authPass|pgpPrivateKey|pgpPassword)/i;

const REDACTED = '[REDACTED]';

export const redactSecrets = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY_PATTERN.test(key) && item ? REDACTED : redactSecrets(item),
    ])
  ) as T;
};

export const preserveRedactedSecrets = <T>(
  incoming: T,
  current: unknown
): T => {
  if (incoming === REDACTED) {
    return current as T;
  }

  if (Array.isArray(incoming)) {
    const currentArray = Array.isArray(current) ? current : [];
    return incoming.map((item, index) => {
      const currentItem =
        item &&
        typeof item === 'object' &&
        'id' in item &&
        currentArray.find(
          (existing) =>
            existing &&
            typeof existing === 'object' &&
            'id' in existing &&
            existing.id === item.id
        );

      return preserveRedactedSecrets(item, currentItem || currentArray[index]);
    }) as T;
  }

  if (!incoming || typeof incoming !== 'object') {
    return incoming;
  }

  const currentRecord =
    current && typeof current === 'object'
      ? (current as Record<string, unknown>)
      : {};

  return Object.fromEntries(
    Object.entries(incoming as Record<string, unknown>).map(([key, item]) => [
      key,
      preserveRedactedSecrets(item, currentRecord[key]),
    ])
  ) as T;
};

export const getRateLimitKey = (req: Request): string => {
  const ip = (req.ip || req.socket.remoteAddress || 'unknown')
    .trim()
    .toLowerCase();

  return net.isIP(ip) ? ipKeyGenerator(ip) : ip;
};

export const safeStringEqual = (left: unknown, right: unknown): boolean => {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const isPrivateIPv4 = (ip: string): boolean => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const isPrivateIPv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
};

export const isLocalOrPrivateAddress = (hostname: string): boolean => {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  if (!normalized) {
    return true;
  }

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }

  if (net.isIPv4(normalized)) {
    return isPrivateIPv4(normalized);
  }

  if (net.isIPv6(normalized)) {
    return isPrivateIPv6(normalized);
  }

  return false;
};

export const resolvesToLocalOrPrivateAddress = async (
  hostname: string
): Promise<boolean> => {
  if (isLocalOrPrivateAddress(hostname)) {
    return true;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some((record) => isLocalOrPrivateAddress(record.address));
  } catch {
    return true;
  }
};

export const isValidHttpUrl = (
  value: unknown,
  options: { allowTemplates?: boolean } = {}
): value is string => {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  const hasTemplate = /\{\{[A-Za-z0-9_]+\}\}/.test(value);
  if (hasTemplate && !options.allowTemplates) {
    return false;
  }

  const candidate = options.allowTemplates
    ? value.replace(/\{\{[A-Za-z0-9_]+\}\}/g, 'template')
    : value;

  try {
    const url = new URL(candidate);
    return Boolean(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export const isSafeHttpUrl = async (
  value: unknown,
  options: { allowTemplates?: boolean; allowPrivateAddresses?: boolean } = {}
): Promise<boolean> => {
  if (!isValidHttpUrl(value, options)) {
    return false;
  }

  if (options.allowPrivateAddresses) {
    return true;
  }

  const candidate = options.allowTemplates
    ? value.replace(/\{\{[A-Za-z0-9_]+\}\}/g, 'template')
    : value;

  try {
    const url = new URL(candidate);
    return !(await resolvesToLocalOrPrivateAddress(url.hostname));
  } catch {
    return false;
  }
};
