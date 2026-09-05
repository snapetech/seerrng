import logger from '@server/logger';
import type { RequestHandler } from 'express';
import http from 'http';

const REQUEST_STATUS_PREFIX = '/request-status';
const DEFAULT_REQUEST_STATUS_ORIGIN = 'http://Seerr-Request-Status:5056';
const REQUEST_STATUS_TIMEOUT_MS = 5_000;
const ALLOWED_PATHS = new Set(['/', '/api/history', '/health']);
const FORWARDED_REQUEST_HEADERS = ['accept', 'cookie', 'user-agent'] as const;
const FORWARDED_RESPONSE_HEADERS = [
  'cache-control',
  'content-length',
  'content-security-policy',
  'content-type',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
] as const;

export const getRequestStatusProxyPath = (
  originalUrl: string
): string | undefined => {
  let requestUrl: URL;
  try {
    requestUrl = new URL(originalUrl, 'http://localhost');
  } catch {
    return undefined;
  }

  let targetPath: string;
  if (
    requestUrl.pathname === REQUEST_STATUS_PREFIX ||
    requestUrl.pathname === `${REQUEST_STATUS_PREFIX}/`
  ) {
    targetPath = '/';
  } else if (requestUrl.pathname.startsWith(`${REQUEST_STATUS_PREFIX}/`)) {
    targetPath = requestUrl.pathname.slice(REQUEST_STATUS_PREFIX.length);
  } else {
    return undefined;
  }

  if (!ALLOWED_PATHS.has(targetPath)) {
    return undefined;
  }

  return `${targetPath}${requestUrl.search}`;
};

export const getRequestStatusOrigin = (
  configuredOrigin = process.env.SEERR_REQUEST_STATUS_ORIGIN
): URL => {
  const origin = new URL(
    configuredOrigin?.trim() || DEFAULT_REQUEST_STATUS_ORIGIN
  );
  if (origin.protocol !== 'http:') {
    throw new Error('Request Status proxy requires an internal HTTP origin.');
  }
  if (origin.username || origin.password || origin.pathname !== '/') {
    throw new Error(
      'Request Status proxy origin must not contain credentials or a path.'
    );
  }
  return origin;
};

export const createRequestStatusProxy = (
  origin = getRequestStatusOrigin()
): RequestHandler => {
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const targetPath = getRequestStatusProxyPath(req.originalUrl);
    if (!targetPath) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const headers: http.OutgoingHttpHeaders = {};
    FORWARDED_REQUEST_HEADERS.forEach((name) => {
      const value = req.headers[name];
      if (value !== undefined) {
        headers[name] = value;
      }
    });

    const upstreamRequest = http.request(
      {
        hostname: origin.hostname,
        port: origin.port || '80',
        method: req.method,
        path: targetPath,
        headers,
      },
      (upstreamResponse) => {
        res.status(upstreamResponse.statusCode ?? 502);
        FORWARDED_RESPONSE_HEADERS.forEach((name) => {
          const value = upstreamResponse.headers[name];
          if (value !== undefined) {
            res.setHeader(name, value);
          }
        });
        upstreamResponse.pipe(res);
      }
    );

    upstreamRequest.setTimeout(REQUEST_STATUS_TIMEOUT_MS, () => {
      upstreamRequest.destroy(new Error('Request Status service timed out.'));
    });
    upstreamRequest.on('error', (error) => {
      logger.warn('Request Status proxy request failed', {
        label: 'Request Status',
        errorMessage: error.message,
      });
      if (!res.headersSent) {
        res
          .status(502)
          .json({ error: 'Request Status is temporarily unavailable.' });
      } else {
        res.destroy(error);
      }
    });
    upstreamRequest.end();
  };
};
