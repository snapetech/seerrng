import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import { createDownloadClient } from '@server/api/downloadClients';
import { mapDelugeTorrent } from '@server/api/downloadClients/deluge';
import { mapQBittorrentTorrent } from '@server/api/downloadClients/qbittorrent';
import { mapTorrentNGTorrent } from '@server/api/downloadClients/torrentng';
import { mapTransmissionTorrent } from '@server/api/downloadClients/transmission';
import {
  DownloadClientError,
  normalizeInfoHash,
} from '@server/api/downloadClients/types';
import type {
  DownloadClientSettings,
  DownloadClientType,
} from '@server/lib/settings';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const withServer = async (
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    body: string
  ) => void,
  run: (port: number) => Promise<void>
) => {
  const server = createServer((request, response) => {
    void readBody(request).then((body) => handler(request, response, body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
};

const settings = (
  type: DownloadClientType,
  port: number,
  overrides: Partial<DownloadClientSettings> = {}
): DownloadClientSettings => ({
  id: 1,
  name: type,
  type,
  enabled: true,
  hostname: '127.0.0.1',
  port,
  useSsl: false,
  baseUrl: '',
  username: 'admin',
  password: 'secret',
  ...overrides,
});

describe('normalizeInfoHash', () => {
  it('accepts v1 and v2 hashes and lowercases them', () => {
    assert.equal(normalizeInfoHash('A'.repeat(40)), HASH_A);
    assert.equal(normalizeInfoHash('c'.repeat(64)), 'c'.repeat(64));
  });

  it('rejects Usenet and malformed IDs', () => {
    assert.equal(normalizeInfoHash('SABnzbd_nzo_abc123'), undefined);
    assert.equal(normalizeInfoHash('a'.repeat(39)), undefined);
    assert.equal(normalizeInfoHash(42), undefined);
  });
});

describe('state mapping', () => {
  it('maps qBittorrent states and its infinite ETA', () => {
    const status = mapQBittorrentTorrent({
      hash: HASH_A.toUpperCase(),
      state: 'stalledDL',
      size: 1000,
      amount_left: 250,
      progress: 0.75,
      dlspeed: 0,
      upspeed: 5,
      eta: 8_640_000,
      num_seeds: 0,
      num_leechs: 3,
    });
    assert.deepEqual(status, {
      hash: HASH_A,
      state: 'stalled',
      size: 1000,
      sizeLeft: 250,
      progress: 0.75,
      downloadRate: 0,
      uploadRate: 5,
      etaSeconds: null,
      seeds: 0,
      peers: 3,
      message: undefined,
    });
  });

  it('maps Transmission errors and unknown ETA', () => {
    const status = mapTransmissionTorrent({
      hashString: HASH_A,
      status: 4,
      error: 2,
      errorString: 'Tracker gave HTTP 404\nsecond line',
      sizeWhenDone: 100,
      leftUntilDone: 40,
      percentDone: 0.6,
      eta: -2,
    });
    assert.equal(status?.state, 'error');
    assert.equal(status?.etaSeconds, null);
    assert.equal(status?.message, 'Tracker gave HTTP 404 second line');
  });

  it('maps Deluge percent progress and treats eta 0 as unknown while incomplete', () => {
    const status = mapDelugeTorrent(HASH_A, {
      state: 'Downloading',
      progress: 50,
      total_wanted: 200,
      total_done: 100,
      download_payload_rate: 10,
      eta: 0,
      num_seeds: 2,
      num_peers: 4,
    });
    assert.equal(status?.progress, 0.5);
    assert.equal(status?.sizeLeft, 100);
    assert.equal(status?.etaSeconds, null);
    assert.equal(status?.state, 'downloading');
  });

  it('maps TorrentNG summaries and estimates ETA from rate', () => {
    const status = mapTorrentNGTorrent({
      hash: HASH_A,
      size_bytes: 1000,
      bytes_done: 600,
      down_rate: 100,
      is_active: true,
      complete: false,
      state: 1,
      peers_complete: 5,
      peers_connected: 9,
    });
    assert.equal(status?.state, 'downloading');
    assert.equal(status?.etaSeconds, 4);
    assert.equal(status?.progress, 0.6);
  });
});

describe('qBittorrent client', () => {
  it('logs in, sends the SID cookie, and re-logs in after the session expires', async () => {
    let logins = 0;
    let infoCalls = 0;
    await withServer(
      (request, response, body) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.pathname === '/api/v2/auth/login') {
          logins += 1;
          assert.equal(body, 'username=admin&password=secret');
          assert.ok(request.headers.referer);
          response.setHeader('Set-Cookie', `SID=session${logins}; HttpOnly`);
          response.end('Ok.');
          return;
        }
        if (url.pathname === '/api/v2/torrents/info') {
          infoCalls += 1;
          // First call: pretend the session expired.
          if (infoCalls === 1) {
            response.statusCode = 403;
            response.end('Forbidden');
            return;
          }
          assert.equal(request.headers.cookie, 'SID=session2');
          assert.equal(url.searchParams.get('hashes'), `${HASH_A}|${HASH_B}`);
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify([
              {
                hash: HASH_A,
                state: 'downloading',
                size: 10,
                amount_left: 5,
                progress: 0.5,
                dlspeed: 1,
                upspeed: 0,
                eta: 5,
                num_seeds: 1,
                num_leechs: 0,
              },
            ])
          );
          return;
        }
        response.statusCode = 404;
        response.end();
      },
      async (port) => {
        const client = createDownloadClient(settings('qbittorrent', port));
        const torrents = await client.getTorrents([HASH_A, HASH_B]);
        assert.equal(torrents.length, 1);
        assert.equal(torrents[0].hash, HASH_A);
        assert.equal(logins, 2);
      }
    );
  });

  it('reports rejected credentials as an auth error', async () => {
    await withServer(
      (_request, response) => response.end('Fails.'),
      async (port) => {
        const client = createDownloadClient(settings('qbittorrent', port));
        await assert.rejects(
          client.testConnection(),
          (error: unknown) =>
            error instanceof DownloadClientError && error.kind === 'auth'
        );
      }
    );
  });
});

describe('Transmission client', () => {
  it('completes the session-id handshake and uses basic auth', async () => {
    let calls = 0;
    await withServer(
      (request, response, body) => {
        calls += 1;
        assert.equal(request.url, '/transmission/rpc');
        assert.equal(
          request.headers.authorization,
          `Basic ${Buffer.from('admin:secret').toString('base64')}`
        );
        if (request.headers['x-transmission-session-id'] !== 'sess-1') {
          response.statusCode = 409;
          response.setHeader('X-Transmission-Session-Id', 'sess-1');
          response.end();
          return;
        }
        const payload = JSON.parse(body);
        assert.equal(payload.method, 'torrent-get');
        assert.deepEqual(payload.arguments.ids, [HASH_A]);
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            result: 'success',
            arguments: {
              torrents: [
                {
                  hashString: HASH_A,
                  status: 6,
                  sizeWhenDone: 10,
                  leftUntilDone: 0,
                  percentDone: 1,
                  eta: -1,
                },
              ],
            },
          })
        );
      },
      async (port) => {
        const client = createDownloadClient(settings('transmission', port));
        const torrents = await client.getTorrents([HASH_A]);
        assert.equal(torrents[0].state, 'seeding');
        assert.equal(calls, 2);
      }
    );
  });
});

describe('Deluge client', () => {
  it('logs in, connects the Web UI to a daemon, and reads torrent status', async () => {
    const methods: string[] = [];
    let connected = false;
    await withServer(
      (request, response, body) => {
        assert.equal(request.url, '/json');
        const { method, params, id } = JSON.parse(body);
        methods.push(method);
        response.setHeader('Content-Type', 'application/json');
        const reply = (result: unknown) =>
          response.end(JSON.stringify({ id, result, error: null }));

        if (method === 'auth.login') {
          assert.deepEqual(params, ['secret']);
          response.setHeader('Set-Cookie', '_session_id=abc; Path=/');
          return reply(true);
        }
        assert.equal(request.headers.cookie, '_session_id=abc');
        if (method === 'web.connected') return reply(connected);
        if (method === 'web.get_hosts')
          return reply([['host-1', '127.0.0.1', 58846, 'Online']]);
        if (method === 'web.connect') {
          assert.deepEqual(params, ['host-1']);
          connected = true;
          return reply([]);
        }
        if (method === 'core.get_torrents_status') {
          assert.deepEqual(params[0], { id: [HASH_A] });
          return reply({
            [HASH_A]: {
              state: 'Seeding',
              progress: 100,
              total_wanted: 50,
              total_done: 50,
            },
          });
        }
        response.end(
          JSON.stringify({ id, result: null, error: { code: 2, message: 'x' } })
        );
      },
      async (port) => {
        const client = createDownloadClient(
          settings('deluge', port, { username: '' })
        );
        const torrents = await client.getTorrents([HASH_A]);
        assert.equal(torrents[0].state, 'seeding');
        assert.equal(torrents[0].sizeLeft, 0);
        assert.deepEqual(methods, [
          'auth.login',
          'web.connected',
          'web.get_hosts',
          'web.connect',
          'core.get_torrents_status',
        ]);
      }
    );
  });
});

describe('TorrentNG client', () => {
  it('sends the bearer token and skips hashes it does not know', async () => {
    await withServer(
      (request, response) => {
        assert.equal(request.headers.authorization, 'Bearer secret');
        response.setHeader('Content-Type', 'application/json');
        if (request.url === `/api/v1/torrents/${HASH_A}`) {
          response.end(
            JSON.stringify({
              hash: HASH_A,
              size_bytes: 100,
              bytes_done: 100,
              complete: true,
              is_active: true,
              state: 1,
            })
          );
          return;
        }
        response.statusCode = 404;
        response.end('{}');
      },
      async (port) => {
        const client = createDownloadClient(
          settings('torrentng', port, { username: '' })
        );
        const torrents = await client.getTorrents([HASH_A, HASH_B]);
        assert.equal(torrents.length, 1);
        assert.equal(torrents[0].state, 'seeding');
      }
    );
  });

  it('treats a rejected token as an auth error', async () => {
    await withServer(
      (_request, response) => {
        response.statusCode = 401;
        response.end();
      },
      async (port) => {
        const client = createDownloadClient(settings('torrentng', port));
        await assert.rejects(
          client.getTorrents([HASH_A]),
          (error: unknown) =>
            error instanceof DownloadClientError && error.kind === 'auth'
        );
      }
    );
  });
});
