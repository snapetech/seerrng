import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import liveDownloadMonitor from '@server/lib/liveDownloads';
import { issueLiveDownloadToken } from '@server/lib/liveDownloadTokens';
import { getSettings, type LiveDownloadSettings } from '@server/lib/settings';
import liveRoutes from '@server/routes/live';
import express from 'express';

const HASH = 'c'.repeat(40);
let qbitReportsTorrent = true;

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

describe('GET /live/downloads', () => {
  let app: Server;
  let appPort: number;
  let qbit: Server;
  let qbitPort: number;
  let previous: LiveDownloadSettings;

  before(async () => {
    previous = getSettings().liveDownloads;

    qbit = createServer((request, response) => {
      if (request.url?.startsWith('/api/v2/auth/login')) {
        response.setHeader('Set-Cookie', 'SID=test');
        response.end('Ok.');
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      const torrents = qbitReportsTorrent
        ? [
            {
              hash: HASH,
              state: 'downloading',
              size: 100,
              amount_left: 40,
              progress: 0.6,
              dlspeed: 10,
              upspeed: 0,
              eta: 4,
              num_seeds: 2,
              num_leechs: 1,
            },
          ]
        : [];
      response.end(JSON.stringify(torrents));
    });
    qbitPort = await listen(qbit);

    const server = express();
    server.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = {
        id: 7,
        hasPermission: () => false,
      };
      next();
    });
    server.use('/live', liveRoutes);
    app = createServer(server);
    appPort = await listen(app);
  });

  after(() => {
    getSettings().liveDownloads = previous;
    liveDownloadMonitor.stop();
    app.close();
    qbit.close();
  });

  const fetchStatus = (path: string) =>
    new Promise<number>((resolve, reject) => {
      get(`http://127.0.0.1:${appPort}${path}`, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }).on('error', reject);
    });

  it('rejects requests without authorized torrent IDs', async () => {
    assert.equal(await fetchStatus('/live/downloads?ids=SABnzbd_nzo_1'), 400);
    assert.equal(await fetchStatus(`/live/downloads?ids=${HASH}`), 400);
  });

  it('returns 204 when no download client is configured', async () => {
    getSettings().liveDownloads = { pollIntervalSeconds: 3, clients: [] };
    const token = issueLiveDownloadToken(HASH, 7);
    assert.ok(token);
    assert.equal(await fetchStatus(`/live/downloads?ids=${token}`), 204);
  });

  it('streams live progress without client details for non-admins', async () => {
    getSettings().liveDownloads = {
      pollIntervalSeconds: 1,
      clients: [
        {
          id: 1,
          name: 'qBit',
          type: 'qbittorrent',
          enabled: true,
          hostname: '127.0.0.1',
          port: qbitPort,
          useSsl: false,
          baseUrl: '',
          username: 'admin',
          password: 'secret',
        },
      ],
    };
    const token = issueLiveDownloadToken(HASH, 7);
    assert.ok(token);

    const event = await new Promise<{
      headers: Record<string, unknown>;
      data: unknown;
    }>((resolve, reject) => {
      const request = get(
        `http://127.0.0.1:${appPort}/live/downloads?ids=${token}`,
        (response) => {
          let buffer = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            buffer += chunk;
            const match = /event: downloads\ndata: (.*)\n\n/.exec(buffer);
            if (match) {
              resolve({
                headers: response.headers,
                data: JSON.parse(match[1]),
              });
              request.destroy();
            }
          });
        }
      );
      request.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') {
          reject(error);
        }
      });
    });

    assert.match(String(event.headers['content-type']), /text\/event-stream/);
    assert.match(String(event.headers['cache-control']), /no-transform/);
    const [update] = event.data as Record<string, unknown>[];
    assert.equal(update.id, token);
    assert.equal('hash' in update, false);
    assert.equal(update.sizeLeft, 40);
    assert.equal(update.seeds, 2);
    assert.equal('clientName' in update, false);

    // The subscription is released when the browser disconnects.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(liveDownloadMonitor.subscriberCount, 0);
  });

  it('clears browser progress when the client stops reporting a torrent', async () => {
    getSettings().liveDownloads = {
      pollIntervalSeconds: 1,
      clients: [
        {
          id: 1,
          name: 'qBit',
          type: 'qbittorrent',
          enabled: true,
          hostname: '127.0.0.1',
          port: qbitPort,
          useSsl: false,
          baseUrl: '',
          username: 'admin',
          password: 'secret',
        },
      ],
    };
    qbitReportsTorrent = true;
    const token = issueLiveDownloadToken(HASH, 7);
    assert.ok(token);

    await new Promise<void>((resolve, reject) => {
      const request = get(
        `http://127.0.0.1:${appPort}/live/downloads?ids=${token}`,
        (response) => {
          let buffer = '';
          let receivedProgress = false;
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            buffer += chunk;
            const events = buffer.matchAll(/event: downloads\ndata: (.*)\n\n/g);
            for (const match of events) {
              const [update] = JSON.parse(match[1]) as Record<
                string,
                unknown
              >[];
              if (update.id !== token) continue;
              if (update.unavailable === true) {
                resolve();
                request.destroy();
                return;
              }
              if (typeof update.progress === 'number' && !receivedProgress) {
                receivedProgress = true;
                qbitReportsTorrent = false;
              }
            }
            // Keep only an unfinished event frame so previous events are not
            // parsed again on the next network chunk.
            const lastFrame = buffer.lastIndexOf('\n\n');
            buffer = lastFrame >= 0 ? buffer.slice(lastFrame + 2) : buffer;
          });
        }
      );
      request.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') {
          reject(error);
        }
      });
      setTimeout(() => {
        request.destroy();
        reject(new Error('Timed out waiting for unavailable progress event.'));
      }, 5_000).unref();
    });

    qbitReportsTorrent = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(liveDownloadMonitor.subscriberCount, 0);
  });
});
