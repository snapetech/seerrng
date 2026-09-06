import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drainForShutdown, type ShutdownServer } from './gracefulShutdown';

class FakeServer implements ShutdownServer {
  public allConnectionsClosed = false;
  public idleConnectionsClosed = false;
  public closeCallback?: (error?: Error) => void;

  public close(callback: (error?: Error) => void): void {
    this.closeCallback = callback;
  }

  public closeAllConnections(): void {
    this.allConnectionsClosed = true;
    this.closeCallback?.();
  }

  public closeIdleConnections(): void {
    this.idleConnectionsClosed = true;
  }
}

describe('drainForShutdown', () => {
  it('drains the listener and background tasks cleanly', async () => {
    const server = new FakeServer();
    let taskFinished = false;
    const drain = drainForShutdown({
      server,
      tasks: [
        {
          name: 'background task',
          run: async () => {
            taskFinished = true;
          },
        },
      ],
      connectionTimeoutMs: 100,
      taskTimeoutMs: 100,
    });
    server.closeCallback?.();

    const result = await drain;

    assert.strictEqual(server.idleConnectionsClosed, true);
    assert.strictEqual(server.allConnectionsClosed, false);
    assert.strictEqual(taskFinished, true);
    assert.deepEqual(result, {
      forcedConnections: false,
      serverError: undefined,
      taskErrors: [],
      timedOutTasks: [],
    });
  });

  it('forces lingering connections and reports unfinished tasks', async () => {
    const server = new FakeServer();
    let release: (() => void) | undefined;

    const result = await drainForShutdown({
      server,
      tasks: [
        {
          name: 'held task',
          run: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        },
      ],
      connectionTimeoutMs: 5,
      taskTimeoutMs: 5,
    });

    assert.strictEqual(server.allConnectionsClosed, true);
    assert.strictEqual(result.forcedConnections, true);
    assert.deepEqual(result.timedOutTasks, ['held task']);
    release?.();
  });

  it('captures task and listener close failures', async () => {
    const server = new FakeServer();
    const drain = drainForShutdown({
      server,
      tasks: [
        {
          name: 'broken task',
          run: async () => {
            throw new Error('task failed');
          },
        },
      ],
      connectionTimeoutMs: 100,
      taskTimeoutMs: 100,
    });
    server.closeCallback?.(new Error('listener failed'));

    const result = await drain;

    assert.strictEqual(result.serverError?.message, 'listener failed');
    assert.strictEqual(result.taskErrors.length, 1);
    assert.strictEqual(result.taskErrors[0].name, 'broken task');
    assert.match(String(result.taskErrors[0].error), /task failed/);
  });

  it('drains both listeners when HTTPS uses an HTTP redirect listener', async () => {
    const httpServer = new FakeServer();
    const httpsServer = new FakeServer();
    const drain = drainForShutdown({
      server: [httpServer, httpsServer],
      tasks: [],
      connectionTimeoutMs: 100,
      taskTimeoutMs: 100,
    });
    httpServer.closeCallback?.();
    httpsServer.closeCallback?.();

    const result = await drain;

    assert.equal(result.forcedConnections, false);
    assert.equal(httpServer.idleConnectionsClosed, true);
    assert.equal(httpsServer.idleConnectionsClosed, true);
  });
});
