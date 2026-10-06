import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import liveDownloadMonitor from '@server/lib/liveDownloads';
import { getSettings, type LiveDownloadSettings } from '@server/lib/settings';
import liveRoutes from '@server/routes/live';
import express from 'express';

const HASH = 'c'.repeat(40);

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
      response.end(
        JSON.stringify([
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
        ])
      );
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

  it('rejects requests without torrent hashes', async () => {
    assert.equal(await fetchStatus('/live/downloads?ids=SABnzbd_nzo_1'), 400);
  });

  it('returns 204 when no download client is configured', async () => {
    getSettings().liveDownloads = { pollIntervalSeconds: 3, clients: [] };
    assert.equal(await fetchStatus(`/live/downloads?ids=${HASH}`), 204);
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

    const event = await new Promise<{
      headers: Record<string, unknown>;
      data: unknown;
    }>((resolve, reject) => {
      const request = get(
        `http://127.0.0.1:${appPort}/live/downloads?ids=${HASH.toUpperCase()}`,
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
    assert.equal(update.hash, HASH);
    assert.equal(update.sizeLeft, 40);
    assert.equal(update.seeds, 2);
    assert.equal('clientName' in update, false);

    // The subscription is released when the browser disconnects.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(liveDownloadMonitor.subscriberCount, 0);
  });
});
