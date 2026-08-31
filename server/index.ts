import PlexAPI from '@server/api/plexapi';
import dataSource, {
  enforceSqliteDatabasePermissions,
  getRepository,
} from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import { Session } from '@server/entity/Session';
import { User } from '@server/entity/User';
import { initI18n } from '@server/i18n';
import { startJobs, stopJobs } from '@server/job/schedule';
import { runWithConfigurationAdmission } from '@server/lib/configurationAdmission';
import { loadExternalRuntimeConfig } from '@server/lib/externalRuntimeConfig';
import notificationManager from '@server/lib/notifications';
import DiscordAgent from '@server/lib/notifications/agents/discord';
import EmailAgent from '@server/lib/notifications/agents/email';
import GotifyAgent from '@server/lib/notifications/agents/gotify';
import NtfyAgent from '@server/lib/notifications/agents/ntfy';
import PushbulletAgent from '@server/lib/notifications/agents/pushbullet';
import PushoverAgent from '@server/lib/notifications/agents/pushover';
import SlackAgent from '@server/lib/notifications/agents/slack';
import TelegramAgent from '@server/lib/notifications/agents/telegram';
import WebhookAgent from '@server/lib/notifications/agents/webhook';
import WebPushAgent from '@server/lib/notifications/agents/webpush';
import checkOverseerrMerge from '@server/lib/overseerrMerge';
import requestDispatchManager from '@server/lib/requestDispatch';
import { getSettings } from '@server/lib/settings';
import { runStartupMigrations } from '@server/lib/startupMigrations';
import { setStaticAssetCacheControl } from '@server/lib/staticAssetCache';
import logger from '@server/logger';
import {
  formatApiErrorResponse,
  getRequestLogPath,
  normalizeApiErrorStatus,
} from '@server/middleware/apiError';
import clearCookies from '@server/middleware/clearcookies';
import csrfProtection, {
  requestUsesSecureTransport,
} from '@server/middleware/csrfProtection';
import csrfTokenCookie from '@server/middleware/csrfTokenCookie';
import securityHeaders from '@server/middleware/securityHeaders';
import routes from '@server/routes';
import {
  resumePendingPasswordResetDeliveries,
  waitForPendingPasswordResetDeliveries,
} from '@server/routes/auth';
import avatarproxy from '@server/routes/avatarproxy';
import imageproxy from '@server/routes/imageproxy';
import { appDataPermissions } from '@server/utils/appDataVolume';
import { getAppVersion } from '@server/utils/appVersion';
import { waitForBackgroundTasks } from '@server/utils/backgroundTasks';
import createCustomProxyAgent, {
  setForceIpv4First,
} from '@server/utils/customProxyAgent';
import { initializeDnsCache } from '@server/utils/dnsCache';
import {
  createProcessShutdownController,
  drainForShutdown,
} from '@server/utils/gracefulShutdown';
import { configureHttpServer, parseListenPort } from '@server/utils/httpServer';
import restartFlag from '@server/utils/restartFlag';
import { getRateLimitKey } from '@server/utils/security';
import { getSessionTransportOptions } from '@server/utils/sessionCookie';
import compression from 'compression';
import { TypeormStore } from 'connect-typeorm/out';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import rateLimit from 'express-rate-limit';
import type { Store } from 'express-session';
import session from 'express-session';
import fs from 'fs/promises';
import http from 'http';
import yaml from 'js-yaml';
import next from 'next';
import path from 'path';
import swaggerUi from 'swagger-ui-express';

const API_SPEC_PATH = path.join(__dirname, '../seerr-api.yml');
const API_BODY_LIMIT = '100kb';
const API_URLENCODED_PARAMETER_LIMIT = 100;
const API_RATE_LIMIT = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  skip: () =>
    process.env.NODE_ENV === 'test' || process.env.E2E_TESTS === 'true',
});
const SHUTDOWN_CONNECTION_TIMEOUT_MS = 10_000;
const SHUTDOWN_TASK_TIMEOUT_MS = 15_000;

const isTruthyEnv = (value?: string): boolean =>
  value?.toLowerCase() === 'true' || value === '1';

const getErrorLogFields = (error: unknown) => ({
  errorMessage: error instanceof Error ? error.message : 'Unknown error',
  errorStack: error instanceof Error ? error.stack : undefined,
});

let requestGracefulShutdown:
  | ((reason: string, requestedExitCode?: number) => void)
  | undefined;

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    label: 'Process',
    ...getErrorLogFields(reason),
  });
  if (requestGracefulShutdown) {
    requestGracefulShutdown('unhandled promise rejection', 1);
  } else {
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    label: 'Process',
    ...getErrorLogFields(error),
  });
  process.exit(1);
});

logger.info(`Starting Seerr version ${getAppVersion()}`);
const dev = process.env.NODE_ENV !== 'production';

if (
  !dev &&
  isTruthyEnv(process.env.SEERR_EXTERNAL_READ_ONLY) &&
  !isTruthyEnv(process.env.SEERR_ALLOW_PRODUCTION_EXTERNAL_READ_ONLY)
) {
  logger.error(
    'Refusing to start production with SEERR_EXTERNAL_READ_ONLY enabled. Set SEERR_ALLOW_PRODUCTION_EXTERNAL_READ_ONLY=true only for an intentional read-only production clone.',
    { label: 'Server' }
  );
  process.exit(1);
}

const app = next({ dev });
const handle = app.getRequestHandler();

if (!appDataPermissions()) {
  logger.error(
    'Something went wrong while checking config folder! Please ensure the config folder is set up properly.\nhttps://snapetech.github.io/seerrng/getting-started'
  );
}

app
  .prepare()
  .then(async () => {
    // Run Overseerr to Seerr migration
    await checkOverseerrMerge();

    const dbConnection = dataSource.isInitialized
      ? dataSource
      : await dataSource.initialize();
    enforceSqliteDatabasePermissions();

    // Run migrations in production unless a prepared test database is being used.
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.SEERR_SKIP_DB_MIGRATIONS !== 'true'
    ) {
      await runStartupMigrations(dbConnection);
    }

    // Load Settings
    const settings = await getSettings().load();
    loadExternalRuntimeConfig();
    restartFlag.initializeSettings(settings);

    initI18n();

    setForceIpv4First(settings.network.forceIpv4First);

    // Add DNS caching
    if (settings.network.dnsCache?.enabled) {
      initializeDnsCache({
        forceMinTtl: settings.network.dnsCache.forceMinTtl,
        forceMaxTtl: settings.network.dnsCache.forceMaxTtl,
      });
    }

    // Register HTTP proxy
    if (settings.network.proxy.enabled) {
      await createCustomProxyAgent(
        settings.network.proxy,
        settings.network.forceIpv4First
      );
    }

    const isE2eTest = isTruthyEnv(process.env.E2E_TESTS);

    // Migrate library types
    if (
      settings.plex.libraries.length > 1 &&
      !settings.plex.libraries[0].type
    ) {
      await runWithConfigurationAdmission('plex', async () => {
        const currentPlex = getSettings().plex;
        if (
          currentPlex.libraries.length <= 1 ||
          currentPlex.libraries[0].type
        ) {
          return;
        }
        const userRepository = getRepository(User);
        const admin = await userRepository.findOne({
          select: { id: true, plexToken: true },
          where: { id: 1 },
        });

        if (admin) {
          logger.info('Migrating Plex libraries to include media type', {
            label: 'Settings',
          });

          const plexapi = new PlexAPI({
            plexToken: admin.plexToken,
            plexSettings: structuredClone(currentPlex),
          });
          await plexapi.syncLibraries();
        }
      });
    }

    // Register Notification Agents
    notificationManager.registerAgents([
      new DiscordAgent(),
      new EmailAgent(),
      new GotifyAgent(),
      new NtfyAgent(),
      new PushbulletAgent(),
      new PushoverAgent(),
      new SlackAgent(),
      new TelegramAgent(),
      new WebhookAgent(),
      new WebPushAgent(),
    ]);
    if (isE2eTest) {
      logger.info('Skipping background delivery loops in E2E test mode', {
        label: 'Server',
      });
    } else {
      await notificationManager.resumePendingNotifications();
      notificationManager.startOutboxRetryLoop();
      await requestDispatchManager.resume();
      requestDispatchManager.start();
      await resumePendingPasswordResetDeliveries();
    }

    const userRepository = getRepository(User);
    const totalUsers = await userRepository.count();
    if (totalUsers > 0 && !isE2eTest) {
      startJobs();
    } else if (isE2eTest) {
      logger.info('Skipping scheduled jobs in E2E test mode', {
        label: 'Server',
      });
    } else {
      logger.info(
        `Skipping starting the scheduled jobs as we have no Plex/Jellyfin/Emby servers setup yet`,
        {
          label: 'Server',
        }
      );
    }

    // Bootstrap Discovery Sliders
    await DiscoverSlider.bootstrapSliders();

    const server = express();
    server.disable('x-powered-by');
    if (settings.network.trustProxy) {
      server.set('trust proxy', 1);
    }
    server.use(securityHeaders);
    server.use(compression());
    server.use(cookieParser(settings.sessionSecret));
    server.use(express.json({ limit: API_BODY_LIMIT }));
    server.use(
      express.urlencoded({
        extended: true,
        limit: API_BODY_LIMIT,
        parameterLimit: API_URLENCODED_PARAMETER_LIMIT,
      })
    );
    if (settings.network.csrfProtection) {
      server.use(csrfProtection());
      server.use(csrfTokenCookie(requestUsesSecureTransport));
    }

    // Set up sessions
    const sessionRespository = getRepository(Session);
    const sessionTransportOptions = getSessionTransportOptions(
      dev,
      settings.network.csrfProtection
    );
    // Cypress drives many concurrent API requests through one SQLite session
    // row. Keep E2E session state process-local so those requests cannot queue
    // behind TypeORM session touches. Production retains durable sessions.
    const sessionStore = isE2eTest
      ? undefined
      : (new TypeormStore({
          cleanupLimit: 2,
          ttl: 60 * 60 * 24 * 30,
        }).connect(sessionRespository) as Store);
    server.use(
      '/api',
      session({
        secret: settings.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: sessionTransportOptions.cookie,
        proxy: sessionTransportOptions.proxy,
        ...(sessionStore ? { store: sessionStore } : {}),
      })
    );
    const apiSpecContent = await fs.readFile(API_SPEC_PATH, 'utf-8');
    const apiDocs = yaml.load(apiSpecContent) as Record<string, unknown>;
    server.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiDocs));
    server.use(
      OpenApiValidator.middleware({
        apiSpec: API_SPEC_PATH,
        validateRequests: true,
      })
    );
    server.use('/api/v1', API_RATE_LIMIT, routes);

    // Do not set cookies so CDNs can cache them
    server.use('/imageproxy', clearCookies, imageproxy);
    server.use('/avatarproxy', clearCookies, avatarproxy);

    server.get('*path', (req, res) => {
      setStaticAssetCacheControl(req, res);

      return handle(req, res);
    });
    server.use(
      (
        err: {
          status?: number;
          message?: string;
          errors?: string[];
          stack?: string;
          error?: string;
        },
        req: Request,
        res: Response,
        // We must provide a next function for the function signature here even though its not used
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: NextFunction
      ) => {
        const status = normalizeApiErrorStatus(err.status);

        if (status >= 500) {
          logger.error('Unhandled API request error', {
            label: 'API',
            method: req.method,
            path: getRequestLogPath(req.originalUrl),
            status,
            errorMessage: err.message,
            errorStack: err.stack,
            errors: err.errors,
          });
        }

        res.status(status).json(formatApiErrorResponse(err, status));
      }
    );

    const port = parseListenPort(process.env.PORT);
    const host = process.env.HOST;
    const listener = configureHttpServer(http.createServer(server));
    if (host) {
      listener.listen(port, host, () => {
        logger.info(`Server ready on ${host} port ${port}`, {
          label: 'Server',
        });
      });
    } else {
      listener.listen(port, () => {
        logger.info(`Server ready on port ${port}`, {
          label: 'Server',
        });
      });
    }

    listener.on('error', (err: Error) => {
      logger.error('Failed to start server', {
        label: 'Server',
        message: err.message,
      });
      process.exit(1);
    });

    let stoppingJobs: Promise<void> | undefined;
    const shutdownController = createProcessShutdownController({
      onStart: (reason) => {
        logger.info(`Received ${reason}; draining server before shutdown.`, {
          label: 'Server',
        });
        notificationManager.stopOutboxRetryLoop();
        requestDispatchManager.stop();
        // Cancel future schedules immediately, while the listener drains.
        stoppingJobs = stopJobs();
      },
      drain: () =>
        drainForShutdown({
          server: listener,
          tasks: [
            {
              name: 'scheduled jobs and background tasks',
              run: async () => {
                await stoppingJobs;
                // Active HTTP handlers may have reached a job invocation or
                // delayed retry immediately before the listener finished
                // draining. A second pass closes that admission race.
                await stopJobs();
                // Reset deliveries can enqueue tracked recovery work. Drain
                // them first so the background-task pass observes that work.
                await waitForPendingPasswordResetDeliveries();
                await waitForBackgroundTasks();
              },
            },
          ],
          connectionTimeoutMs: SHUTDOWN_CONNECTION_TIMEOUT_MS,
          taskTimeoutMs: SHUTDOWN_TASK_TIMEOUT_MS,
        }),
      onComplete: (result, failed) => {
        const log = failed
          ? logger.error.bind(logger)
          : logger.info.bind(logger);
        log(
          failed
            ? 'Server shutdown drain finished with incomplete work.'
            : 'Server shutdown drain completed.',
          {
            label: 'Server',
            forcedConnections: result.forcedConnections,
            serverError: result.serverError?.message,
            taskErrors: result.taskErrors.map(({ name, error }) => ({
              name,
              errorMessage:
                error instanceof Error ? error.message : 'Unknown error',
            })),
            timedOutTasks: result.timedOutTasks,
          }
        );
      },
      onError: (error) => {
        logger.error('Server shutdown drain failed.', {
          label: 'Server',
          ...getErrorLogFields(error),
        });
      },
    });

    requestGracefulShutdown = shutdownController.request;
  })
  .catch((err) => {
    logger.error(err.stack);
    process.exit(1);
  });
