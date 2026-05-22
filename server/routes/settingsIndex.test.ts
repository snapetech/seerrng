import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import { scheduledJobs } from '@server/job/schedule';
import { getSettings } from '@server/lib/settings';
import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import settingsRoutes, {
  deepLogValueStrings,
  parseLogMessages,
} from './settings';

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/settings', settingsRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(() => {
  app = createApp();
});

beforeEach(() => {
  const settings = getSettings();
  settings.plex.libraries = [
    { id: '1', name: 'Movies', enabled: false, type: 'movie' },
  ];
  settings.jellyfin.libraries = [
    { id: '2', name: 'Shows', enabled: false, type: 'show' },
  ];
  mock.method(settings, 'save', async () => undefined);
});

afterEach(() => {
  scheduledJobs.length = 0;
  mock.restoreAll();
});

describe('Settings route input validation', () => {
  it('rejects malformed persisted settings bodies before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const mainRes = await request(app).post('/settings/main').send([]);
    const networkRes = await request(app).post('/settings/network').send([]);
    const tautulliRes = await request(app).post('/settings/tautulli').send([]);

    assert.strictEqual(mainRes.status, 400);
    assert.match(mainRes.body.message, /Settings body must be an object/);
    assert.strictEqual(networkRes.status, 400);
    assert.match(networkRes.body.message, /Settings body must be an object/);
    assert.strictEqual(tautulliRes.status, 400);
    assert.match(tautulliRes.body.message, /Settings body must be an object/);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed main settings values before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const appUrlRes = await request(app)
      .post('/settings/main')
      .send({ applicationUrl: 'javascript:alert(1)' });
    const trailingUrlRes = await request(app)
      .post('/settings/main')
      .send({ youtubeUrl: 'https://youtube.com/' });
    const boolRes = await request(app)
      .post('/settings/main')
      .send({ localLogin: 'true' });
    const tagsLimitRes = await request(app)
      .post('/settings/main')
      .send({ blocklistedTagsLimit: 251 });

    assert.strictEqual(appUrlRes.status, 400);
    assert.match(
      appUrlRes.body.message,
      /applicationUrl must be a valid HTTP URL/
    );
    assert.strictEqual(trailingUrlRes.status, 400);
    assert.match(
      trailingUrlRes.body.message,
      /youtubeUrl must not end with a slash/
    );
    assert.strictEqual(boolRes.status, 400);
    assert.match(boolRes.body.message, /localLogin must be a boolean/);
    assert.strictEqual(tagsLimitRes.status, 400);
    assert.match(
      tagsLimitRes.body.message,
      /blocklistedTagsLimit must be a valid number/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed main default quota settings before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const shapeRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: [] });
    const nestedShapeRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: { movie: [] } });
    const quotaLimitRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: { movie: { quotaLimit: 'nope' } } });
    const quotaDaysRes = await request(app)
      .post('/settings/main')
      .send({ defaultQuotas: { book: { quotaDays: 10001 } } });

    assert.strictEqual(shapeRes.status, 400);
    assert.match(shapeRes.body.message, /defaultQuotas must be an object/);
    assert.strictEqual(nestedShapeRes.status, 400);
    assert.match(
      nestedShapeRes.body.message,
      /defaultQuotas.movie must be an object/
    );
    assert.strictEqual(quotaLimitRes.status, 400);
    assert.match(
      quotaLimitRes.body.message,
      /defaultQuotas.movie.quotaLimit must be a valid number/
    );
    assert.strictEqual(quotaDaysRes.status, 400);
    assert.match(
      quotaDaysRes.body.message,
      /defaultQuotas.book.quotaDays must be a valid number/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects unsafe Tautulli external URLs before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const res = await request(app).post('/settings/tautulli').send({
      externalUrl: 'javascript:alert(1)',
    });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /externalUrl must be a valid HTTP URL/);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects unsafe media server browser URLs before external work', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const plexRes = await request(app).post('/settings/plex').send({
      webAppUrl: 'javascript:alert(1)',
    });
    const jellyfinRes = await request(app).post('/settings/jellyfin').send({
      externalHostname: 'javascript:alert(1)',
    });
    const jellyfinResetRes = await request(app)
      .post('/settings/jellyfin')
      .send({
        jellyfinForgotPasswordUrl: 'javascript:alert(1)',
      });

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /webAppUrl must be a valid HTTP URL/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(
      jellyfinRes.body.message,
      /externalHostname must be a valid HTTP URL/
    );
    assert.strictEqual(jellyfinResetRes.status, 400);
    assert.match(
      jellyfinResetRes.body.message,
      /jellyfinForgotPasswordUrl must be a valid HTTP URL/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed network proxy settings before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const proxyShapeRes = await request(app)
      .post('/settings/network')
      .send({ proxy: [] });
    const proxyPortRes = await request(app)
      .post('/settings/network')
      .send({ proxy: { enabled: true, hostname: 'proxy.local', port: 70000 } });
    const proxyEnabledRes = await request(app)
      .post('/settings/network')
      .send({ proxy: { enabled: 'true' } });

    assert.strictEqual(proxyShapeRes.status, 400);
    assert.match(proxyShapeRes.body.message, /proxy must be an object/);
    assert.strictEqual(proxyPortRes.status, 400);
    assert.match(
      proxyPortRes.body.message,
      /proxy.port must be a valid number/
    );
    assert.strictEqual(proxyEnabledRes.status, 400);
    assert.match(
      proxyEnabledRes.body.message,
      /proxy.enabled must be a boolean/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed network DNS and timeout settings before saving', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const dnsShapeRes = await request(app)
      .post('/settings/network')
      .send({ dnsCache: [] });
    const dnsTtlRes = await request(app)
      .post('/settings/network')
      .send({ dnsCache: { forceMaxTtl: 999999 } });
    const timeoutRes = await request(app)
      .post('/settings/network')
      .send({ apiRequestTimeout: 999999 });

    assert.strictEqual(dnsShapeRes.status, 400);
    assert.match(dnsShapeRes.body.message, /dnsCache must be an object/);
    assert.strictEqual(dnsTtlRes.status, 400);
    assert.match(
      dnsTtlRes.body.message,
      /dnsCache.forceMaxTtl must be a valid number/
    );
    assert.strictEqual(timeoutRes.status, 400);
    assert.match(
      timeoutRes.body.message,
      /apiRequestTimeout must be a valid number/
    );
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects malformed media server settings bodies before external work', async () => {
    const settings = getSettings();
    const saveMock = mock.method(settings, 'save', async () => undefined);

    const plexRes = await request(app).post('/settings/plex').send([]);
    const jellyfinRes = await request(app).post('/settings/jellyfin').send([]);

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /Settings body must be an object/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(jellyfinRes.body.message, /Settings body must be an object/);
    assert.strictEqual(saveMock.mock.callCount(), 0);
  });

  it('rejects array Plex library enable queries instead of throwing', async () => {
    const res = await request(app)
      .get('/settings/plex/library')
      .query({ enable: ['1', '2'] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(getSettings().plex.libraries[0].enabled, false);
  });

  it('rejects non-boolean Plex library sync flags', async () => {
    const res = await request(app)
      .get('/settings/plex/library')
      .query({ sync: 'yes' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sync must be valid/);
  });

  it('rejects array Jellyfin library enable queries instead of throwing', async () => {
    const res = await request(app)
      .get('/settings/jellyfin/library')
      .query({ enable: ['1', '2'] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(getSettings().jellyfin.libraries[0].enabled, false);
  });

  it('rejects non-boolean Jellyfin library sync flags', async () => {
    const res = await request(app)
      .get('/settings/jellyfin/library')
      .query({ sync: 'yes' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Sync must be valid/);
  });

  it('rejects string scanner commands', async () => {
    const plexRes = await request(app)
      .post('/settings/plex/sync')
      .send({ start: 'true' });
    const jellyfinRes = await request(app)
      .post('/settings/jellyfin/sync')
      .send({ cancel: 'true' });

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /Start must be a boolean/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(jellyfinRes.body.message, /Cancel must be a boolean/);
  });

  it('rejects malformed scanner command bodies', async () => {
    const plexRes = await request(app).post('/settings/plex/sync').send([]);
    const jellyfinRes = await request(app)
      .post('/settings/jellyfin/sync')
      .send([]);

    assert.strictEqual(plexRes.status, 400);
    assert.match(plexRes.body.message, /Settings body must be an object/);
    assert.strictEqual(jellyfinRes.status, 400);
    assert.match(jellyfinRes.body.message, /Settings body must be an object/);
  });

  it('rejects malformed metadata test bodies before provider calls', async () => {
    const arrayRes = await request(app)
      .post('/settings/metadatas/test')
      .send([]);
    const flagRes = await request(app)
      .post('/settings/metadatas/test')
      .send({ tmdb: 'true' });

    assert.strictEqual(arrayRes.status, 400);
    assert.match(arrayRes.body.error, /Invalid metadata test settings/);
    assert.strictEqual(flagRes.status, 400);
    assert.match(flagRes.body.error, /Metadata test flags must be booleans/);
  });

  it('rejects malformed log search values before reading logs', async () => {
    const res = await request(app).get(
      '/settings/logs?search=error&search=warn'
    );

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Search must be a string/);
  });

  it('rejects unknown log filters before reading logs', async () => {
    const res = await request(app).get('/settings/logs?filter=trace');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /Filter must be valid/);
  });

  it('bounds and redacts parsed log records', () => {
    const validLine = JSON.stringify({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'error',
      message: 'failed with token',
      apiKey: 'super-secret',
    });
    const oversizedLine = JSON.stringify({
      level: 'error',
      message: 'x'.repeat(70 * 1024),
    });
    const malformedShape = JSON.stringify({
      level: 'error',
      message: { nested: 'not a string' },
    });

    const logs = parseLogMessages(
      [validLine, oversizedLine, malformedShape, 'not-json'].join('\n'),
      ['error']
    );

    assert.strictEqual(logs.length, 1);
    assert.deepStrictEqual(logs[0].data, { apiKey: '[REDACTED]' });
  });

  it('bounds deep log search traversal', () => {
    let nested: Record<string, unknown> = { value: 'too-deep' };
    for (let i = 0; i < 20; i += 1) {
      nested = { nested };
    }

    const values = deepLogValueStrings(nested, 8, 5);

    assert.deepStrictEqual(values, []);
  });

  it('rejects malformed webhook notification bodies before persistence', async () => {
    const missingOptions = await request(app)
      .post('/settings/notifications/webhook')
      .send({ enabled: false, types: 0 });
    const stringEnabled = await request(app)
      .post('/settings/notifications/webhook')
      .send({
        enabled: 'false',
        types: 0,
        options: {
          webhookUrl: 'https://example.com/webhook',
          jsonPayload: '{}',
        },
      });

    assert.strictEqual(missingOptions.status, 400);
    assert.match(
      missingOptions.body.message,
      /Webhook options must be an object/
    );
    assert.strictEqual(stringEnabled.status, 400);
    assert.match(stringEnabled.body.message, /Enabled must be a boolean/);
  });

  it('persists normalized webhook notification bodies', async () => {
    const res = await request(app)
      .post('/settings/notifications/webhook')
      .send({
        enabled: false,
        embedPoster: true,
        types: 7,
        options: {
          webhookUrl: 'https://example.com/webhook',
          jsonPayload: '{}',
          authHeader: 'Bearer test',
          customHeaders: [{ key: 'X-Test', value: 'ok' }],
          supportVariables: true,
        },
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      getSettings().notifications.agents.webhook.enabled,
      false
    );
    assert.strictEqual(getSettings().notifications.agents.webhook.types, 7);
    assert.deepStrictEqual(
      getSettings().notifications.agents.webhook.options.customHeaders,
      [{ key: 'X-Test', value: 'ok' }]
    );
  });

  it('rejects malformed Gotify and ntfy notification bodies before persistence', async () => {
    const gotifyRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: 'false',
        types: 0,
        options: { url: 'https://example.com/gotify' },
      });
    const ntfyRes = await request(app)
      .post('/settings/notifications/ntfy')
      .send({
        enabled: false,
        types: '1',
        options: { url: 'https://example.com/ntfy' },
      });

    assert.strictEqual(gotifyRes.status, 400);
    assert.match(gotifyRes.body.message, /Enabled must be a boolean/);
    assert.strictEqual(ntfyRes.status, 400);
    assert.match(ntfyRes.body.message, /Notification types must be valid/);
  });

  it('rejects malformed Gotify and ntfy notification options before persistence', async () => {
    const gotifyTokenRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: false,
        types: 0,
        options: {
          url: 'https://example.com/gotify',
          token: 123,
          priority: 5,
        },
      });
    const gotifyPriorityRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: false,
        types: 0,
        options: {
          url: 'https://example.com/gotify',
          token: 'token',
          priority: 1001,
        },
      });
    const ntfyAuthRes = await request(app)
      .post('/settings/notifications/ntfy')
      .send({
        enabled: false,
        types: 0,
        options: {
          url: 'https://example.com/ntfy',
          topic: 'topic',
          authMethodToken: 'true',
        },
      });

    assert.strictEqual(gotifyTokenRes.status, 400);
    assert.match(gotifyTokenRes.body.message, /Gotify token must be a string/);
    assert.strictEqual(gotifyPriorityRes.status, 400);
    assert.match(
      gotifyPriorityRes.body.message,
      /Gotify priority must be an integer/
    );
    assert.strictEqual(ntfyAuthRes.status, 400);
    assert.match(
      ntfyAuthRes.body.message,
      /ntfy authMethodToken must be a boolean/
    );
  });

  it('persists normalized Gotify and ntfy notification bodies', async () => {
    const gotifyRes = await request(app)
      .post('/settings/notifications/gotify')
      .send({
        enabled: false,
        embedPoster: true,
        types: 3,
        options: {
          url: 'https://example.com/gotify',
          token: 'token',
          priority: 5,
          locale: 'en',
        },
      });
    const ntfyRes = await request(app)
      .post('/settings/notifications/ntfy')
      .send({
        enabled: false,
        embedPoster: false,
        types: 4,
        options: {
          url: 'https://example.com/ntfy',
          topic: 'topic',
          locale: 'en',
        },
      });

    assert.strictEqual(gotifyRes.status, 200);
    assert.strictEqual(ntfyRes.status, 200);
    assert.strictEqual(
      getSettings().notifications.agents.gotify.enabled,
      false
    );
    assert.strictEqual(getSettings().notifications.agents.gotify.types, 3);
    assert.strictEqual(getSettings().notifications.agents.ntfy.enabled, false);
    assert.strictEqual(getSettings().notifications.agents.ntfy.types, 4);
  });

  it('rejects malformed Discord and Slack notification bodies before persistence', async () => {
    const discordRes = await request(app)
      .post('/settings/notifications/discord')
      .send({
        enabled: 'false',
        types: 0,
        options: { webhookUrl: 'https://example.com/discord' },
      });
    const slackRes = await request(app)
      .post('/settings/notifications/slack')
      .send({
        enabled: false,
        types: 0,
        options: { webhookUrl: 123 },
      });

    assert.strictEqual(discordRes.status, 400);
    assert.match(discordRes.body.message, /Enabled must be a boolean/);
    assert.strictEqual(slackRes.status, 400);
    assert.match(slackRes.body.message, /Slack webhook URL must be a string/);
  });

  it('persists normalized Discord and Slack notification bodies', async () => {
    const discordRes = await request(app)
      .post('/settings/notifications/discord')
      .send({
        enabled: false,
        embedPoster: true,
        types: 5,
        options: {
          webhookUrl: 'https://example.com/discord',
          botUsername: 'Seerr',
          enableMentions: false,
          locale: 'en',
          useUserLocale: false,
        },
      });
    const slackRes = await request(app)
      .post('/settings/notifications/slack')
      .send({
        enabled: false,
        embedPoster: false,
        types: 6,
        options: {
          webhookUrl: 'https://example.com/slack',
          locale: 'en',
        },
      });

    assert.strictEqual(discordRes.status, 200);
    assert.strictEqual(slackRes.status, 200);
    assert.strictEqual(
      getSettings().notifications.agents.discord.enabled,
      false
    );
    assert.strictEqual(getSettings().notifications.agents.discord.types, 5);
    assert.strictEqual(getSettings().notifications.agents.slack.enabled, false);
    assert.strictEqual(getSettings().notifications.agents.slack.types, 6);
  });

  it('rejects malformed remaining notification bodies before persistence', async () => {
    const telegramRes = await request(app)
      .post('/settings/notifications/telegram')
      .send({
        enabled: 'false',
        types: 0,
        options: {
          botAPI: 'token',
          chatId: 'chat',
          messageThreadId: '',
          sendSilently: false,
        },
      });
    const pushbulletRes = await request(app)
      .post('/settings/notifications/pushbullet')
      .send({
        enabled: false,
        types: 0,
        options: { accessToken: 123 },
      });
    const pushoverRes = await request(app)
      .post('/settings/notifications/pushover')
      .send({
        enabled: false,
        types: '0',
        options: {
          accessToken: 'token',
          userToken: 'user',
          sound: 'pushover',
        },
      });
    const emailRes = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        types: 0,
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: '587',
          secure: false,
          ignoreTls: false,
          requireTls: false,
          allowSelfSigned: false,
          senderName: 'Seerr',
        },
      });
    const webpushRes = await request(app)
      .post('/settings/notifications/webpush')
      .send({ enabled: false, types: 0 });

    assert.strictEqual(telegramRes.status, 400);
    assert.match(telegramRes.body.message, /Enabled must be a boolean/);
    assert.strictEqual(pushbulletRes.status, 400);
    assert.match(pushbulletRes.body.message, /accessToken must be a string/);
    assert.strictEqual(pushoverRes.status, 400);
    assert.match(pushoverRes.body.message, /Notification types must be valid/);
    assert.strictEqual(emailRes.status, 400);
    assert.match(
      emailRes.body.message,
      /smtpPort must be an integer between 1 and 65535/
    );
    assert.strictEqual(webpushRes.status, 400);
    assert.match(webpushRes.body.message, /Web push options must be an object/);
  });

  it('rejects oversized generic notification option values before saving', async () => {
    const tokenRes = await request(app)
      .post('/settings/notifications/pushbullet')
      .send({
        enabled: false,
        types: 0,
        options: { accessToken: 'x'.repeat(4097) },
      });
    const portRes = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        types: 0,
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 70000,
          secure: false,
          ignoreTls: false,
          requireTls: false,
          allowSelfSigned: false,
          senderName: 'Seerr',
        },
      });

    assert.strictEqual(tokenRes.status, 400);
    assert.match(tokenRes.body.message, /accessToken must be 4096 characters/);
    assert.strictEqual(portRes.status, 400);
    assert.match(
      portRes.body.message,
      /smtpPort must be an integer between 1 and 65535/
    );
  });

  it('persists normalized remaining notification bodies', async () => {
    const telegramRes = await request(app)
      .post('/settings/notifications/telegram')
      .send({
        enabled: false,
        embedPoster: true,
        types: 8,
        options: {
          botAPI: 'token',
          chatId: 'chat',
          messageThreadId: '',
          sendSilently: false,
        },
      });
    const pushbulletRes = await request(app)
      .post('/settings/notifications/pushbullet')
      .send({
        enabled: false,
        embedPoster: false,
        types: 9,
        options: { accessToken: 'token' },
      });
    const pushoverRes = await request(app)
      .post('/settings/notifications/pushover')
      .send({
        enabled: false,
        embedPoster: true,
        types: 10,
        options: {
          accessToken: 'token',
          userToken: 'user',
          sound: 'pushover',
        },
      });
    const emailRes = await request(app)
      .post('/settings/notifications/email')
      .send({
        enabled: false,
        embedPoster: false,
        types: 11,
        options: {
          userEmailRequired: false,
          emailFrom: 'test@example.com',
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          secure: false,
          ignoreTls: false,
          requireTls: false,
          allowSelfSigned: false,
          senderName: 'Seerr',
        },
      });
    const webpushRes = await request(app)
      .post('/settings/notifications/webpush')
      .send({
        enabled: false,
        embedPoster: true,
        types: 12,
        options: {},
      });

    assert.strictEqual(telegramRes.status, 200);
    assert.strictEqual(pushbulletRes.status, 200);
    assert.strictEqual(pushoverRes.status, 200);
    assert.strictEqual(emailRes.status, 200);
    assert.strictEqual(webpushRes.status, 200);
    assert.strictEqual(getSettings().notifications.agents.telegram.types, 8);
    assert.strictEqual(getSettings().notifications.agents.pushbullet.types, 9);
    assert.strictEqual(getSettings().notifications.agents.pushover.types, 10);
    assert.strictEqual(getSettings().notifications.agents.email.types, 11);
    assert.strictEqual(getSettings().notifications.agents.webpush.types, 12);
  });

  it('rejects oversized job IDs before lookup', async () => {
    const res = await request(app).post(
      `/settings/jobs/${'x'.repeat(129)}/run`
    );

    assert.strictEqual(res.status, 404);
  });

  it('does not invoke a job that already reports running', async () => {
    let invoked = false;
    scheduledJobs.push({
      id: 'radarr-scan',
      name: 'Radarr Scan',
      type: 'process',
      interval: 'hours',
      cronSchedule: '0 0 * * *',
      job: {
        invoke: () => {
          invoked = true;
        },
        nextInvocation: () => null,
      } as never,
      running: () => true,
    });

    const res = await request(app).post('/settings/jobs/radarr-scan/run');

    assert.strictEqual(res.status, 409);
    assert.match(res.body.message, /already running/);
    assert.strictEqual(invoked, false);
  });

  it('rejects oversized cache IDs before lookup', async () => {
    const res = await request(app).post(
      `/settings/cache/${'x'.repeat(129)}/flush`
    );

    assert.strictEqual(res.status, 404);
  });

  it('rejects prototype cache IDs instead of treating them as cache objects', async () => {
    const res = await request(app).post('/settings/cache/__proto__/flush');

    assert.strictEqual(res.status, 404);
    assert.match(res.body.message, /Cache not found/);
  });
});
