import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { Notification } from '@server/lib/notifications';
import axios from 'axios';
import { NOTIFICATION_HTTP_OPTIONS } from './agent';
import WebhookAgent, { MAX_WEBHOOK_URL_LENGTH } from './webhook';

afterEach(() => {
  mock.restoreAll();
  delete process.env.SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS;
});

describe('NOTIFICATION_HTTP_OPTIONS', () => {
  it('bounds outbound notification HTTP requests', () => {
    assert.equal(NOTIFICATION_HTTP_OPTIONS.timeout, 10_000);
    assert.equal(NOTIFICATION_HTTP_OPTIONS.maxBodyLength, 128 * 1024);
    assert.equal(NOTIFICATION_HTTP_OPTIONS.maxContentLength, 128 * 1024);
  });
});

describe('WebhookAgent', () => {
  it('rejects oversized rendered webhook URLs before sending', async () => {
    process.env.SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS = 'true';
    const postMock = mock.method(axios, 'post', async () => ({ data: {} }));

    const agent = new WebhookAgent({
      enabled: true,
      embedPoster: false,
      types: Notification.MEDIA_AVAILABLE,
      options: {
        webhookUrl: 'http://127.0.0.1/webhook?subject={{subject}}',
        jsonPayload: Buffer.from(JSON.stringify(JSON.stringify({}))).toString(
          'base64'
        ),
        customHeaders: [],
        supportVariables: true,
      },
    });

    const sent = await agent.send(Notification.MEDIA_AVAILABLE, {
      notifySystem: true,
      notifyAdmin: false,
      subject: 'x'.repeat(MAX_WEBHOOK_URL_LENGTH),
      message: 'message',
    });

    assert.equal(sent, false);
    assert.equal(postMock.mock.callCount(), 0);
  });

  it('rejects deeply nested payload templates before sending', async () => {
    process.env.SEERR_ALLOW_PRIVATE_NOTIFICATION_URLS = 'true';
    const postMock = mock.method(axios, 'post', async () => ({ data: {} }));
    let nested: Record<string, unknown> = { value: '{{subject}}' };
    for (let i = 0; i < 40; i += 1) {
      nested = { nested };
    }

    const agent = new WebhookAgent({
      enabled: true,
      embedPoster: false,
      types: Notification.TEST_NOTIFICATION,
      options: {
        webhookUrl: 'http://127.0.0.1/webhook',
        jsonPayload: Buffer.from(
          JSON.stringify(JSON.stringify(nested))
        ).toString('base64'),
        customHeaders: [],
        supportVariables: false,
      },
    });

    const sent = await agent.send(Notification.TEST_NOTIFICATION, {
      notifySystem: true,
      notifyAdmin: false,
      subject: 'subject',
      message: 'message',
    });

    assert.equal(sent, false);
    assert.equal(postMock.mock.callCount(), 0);
  });
});
