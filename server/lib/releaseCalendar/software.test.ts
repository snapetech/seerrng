import QuestarrNGAPI from '@server/api/software/questarrng';
import ROMarrNGAPI from '@server/api/software/romarrng';
import type { SoftwareCatalogGame } from '@server/api/software/types';
import { getRepository } from '@server/datasource';
import SoftwareRequest, {
  type SoftwareRequestCategory,
  type SoftwareRequestStatus,
} from '@server/entity/SoftwareRequest';
import { getSettings } from '@server/lib/settings';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import { getReleaseCalendar } from './index';
import { parseCalendarQuery } from './query';

setupTestDb();
afterEach(() => mock.restoreAll());

const range = { start: '2026-09-01', end: '2026-10-01' };

const configureProviders = () => {
  const settings = getSettings();
  settings.radarr = [];
  settings.sonarr = [];
  settings.lidarr = [];
  settings.readarr = [];
  settings.main.enabledMediaCategories = {
    ...settings.main.enabledMediaCategories,
    game: true,
    retro: true,
    modern: true,
  };
  settings.softwareAcquisition = {
    steamApiKey: '',
    romarr: {
      hostname: '127.0.0.1',
      port: 6868,
      useSsl: false,
      baseUrl: '',
      apiKey: 'romarr-test-key',
    },
    questarr: {
      hostname: '127.0.0.1',
      port: 3000,
      useSsl: false,
      baseUrl: '',
      apiKey: 'questarr-test-key',
    },
    emulationCatalogProvider: 'romarr',
    emulationSystemGroups: {},
    emulationPlatformMappings: {},
  };
};

let requestNumber = 0;
const addSoftwareRequest = async (options: {
  requestedById: number;
  category: SoftwareRequestCategory;
  catalogId: number;
  status?: SoftwareRequestStatus;
  platformName?: string;
  platformId?: number;
  operatingSystem?: SoftwareRequest['operatingSystem'];
  architecture?: SoftwareRequest['architecture'];
}) => {
  const repository = getRepository(SoftwareRequest);
  requestNumber += 1;
  const categoryProvider = options.category === 'game' ? 'questarr' : 'romarr';
  return repository.save(
    repository.create({
      requestedById: options.requestedById,
      category: options.category,
      provider: categoryProvider,
      status: options.status ?? 'approved',
      externalRequestId: `calendar-test:${requestNumber}`,
      catalogId: options.catalogId,
      title: `Requested game ${options.catalogId}`,
      platformName: options.platformName ?? null,
      platformId: options.platformId ?? null,
      operatingSystem: options.operatingSystem ?? null,
      architecture: options.architecture ?? null,
      attempt: 0,
    })
  );
};

const game = (
  igdbId: number,
  platformReleaseDate: string | null = '2026-09-15'
): SoftwareCatalogGame => ({
  id: `igdb-${igdbId}`,
  igdbId,
  title: `Catalog game ${igdbId}`,
  summary: '',
  coverUrl: '',
  releaseDate: '2025-01-01',
  platformReleaseDate,
  platforms: [],
  platformOptions: [],
  genres: [],
});

it('keeps software releases in personal calendars and respects shared scope', async () => {
  configureProviders();
  await addSoftwareRequest({
    requestedById: 1,
    category: 'game',
    catalogId: 42,
    operatingSystem: 'linux',
    architecture: 'x64',
    status: 'approved',
  });
  await addSoftwareRequest({
    requestedById: 2,
    category: 'game',
    catalogId: 42,
    operatingSystem: 'windows',
    architecture: 'x64',
    status: 'available',
  });
  await addSoftwareRequest({
    requestedById: 2,
    category: 'game',
    catalogId: 42,
    operatingSystem: 'macos',
    architecture: 'universal',
  });
  await addSoftwareRequest({
    requestedById: 1,
    category: 'retro',
    catalogId: 42,
    platformName: 'Nintendo Entertainment System',
    platformId: 130,
    status: 'downloading',
  });
  await addSoftwareRequest({
    requestedById: 2,
    category: 'modern',
    catalogId: 43,
    platformName: 'Steam Deck',
    platformId: 167,
  });
  const questarrLookup = mock.method(
    QuestarrNGAPI.prototype,
    'getCatalogGame',
    async (igdbId: number, platformId?: number) =>
      game(
        igdbId,
        platformId === 3
          ? '2026-09-15'
          : platformId === 6
            ? '2026-09-20'
            : '2026-09-25'
      )
  );
  const romarrLookup = mock.method(
    ROMarrNGAPI.prototype,
    'getCatalogGame',
    async (igdbId: number, platformId?: number) =>
      game(igdbId, platformId === 130 ? '2026-09-15' : '2026-09-20')
  );

  const personal = await getReleaseCalendar(
    parseCalendarQuery({ ...range, mediaType: 'software' }, false, false),
    1,
    false,
    { includeDateHistory: false }
  );
  assert.deepEqual(
    personal.results
      .map((item) => [item.id, item.platformName, item.available])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    [
      ['software:game:42:3', 'Linux · x64', false],
      ['software:retro:42:130', 'Nintendo Entertainment System', false],
    ].sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  );

  const shared = await getReleaseCalendar(
    parseCalendarQuery(
      { ...range, scope: 'all', mediaType: 'software' },
      true,
      false
    ),
    1,
    false,
    { includeDateHistory: false }
  );
  assert.deepEqual(
    shared.results
      .map((item) => [item.id, item.source, item.platformName, item.available])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    [
      ['software:game:42:3', 'questarr', 'Linux · x64', false],
      ['software:game:42:6', 'questarr', 'Windows · x64', true],
      ['software:game:42:14', 'questarr', 'macOS · universal', false],
      ['software:modern:43:167', 'romarr', 'Steam Deck', false],
      [
        'software:retro:42:130',
        'romarr',
        'Nintendo Entertainment System',
        false,
      ],
    ].sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  );
  assert.deepEqual(
    questarrLookup.mock.calls
      .map((call) => call.arguments)
      .sort((left, right) => Number(left[1]) - Number(right[1])),
    [
      [42, 3],
      [42, 3],
      [42, 6],
      [42, 14],
    ]
  );
  assert.deepEqual(
    romarrLookup.mock.calls
      .map((call) => call.arguments)
      .sort(
        (left, right) =>
          Number(left[0]) - Number(right[0]) ||
          Number(left[1]) - Number(right[1])
      ),
    [
      [42, 130],
      [42, 130],
      [43, 167],
    ]
  );
});

it('omits invalid dates and reports an unavailable software catalog without leaking errors', async () => {
  configureProviders();
  await addSoftwareRequest({
    requestedById: 1,
    category: 'retro',
    catalogId: 44,
    platformName: 'NES',
    platformId: 130,
  });
  await addSoftwareRequest({
    requestedById: 1,
    category: 'retro',
    catalogId: 47,
    platformName: 'Game Boy Advance',
    platformId: 120,
  });
  await addSoftwareRequest({
    requestedById: 1,
    category: 'modern',
    catalogId: 45,
    platformName: 'Steam Deck',
    platformId: 167,
  });
  mock.method(
    ROMarrNGAPI.prototype,
    'getCatalogGame',
    async (igdbId: number) => {
      if (igdbId === 44) return game(igdbId, '2026-02-30');
      if (igdbId === 47) return game(igdbId, null);
      throw new Error('upstream failure includes private-api-key');
    }
  );

  const result = await getReleaseCalendar(
    parseCalendarQuery(
      { ...range, scope: 'all', mediaType: 'software' },
      true,
      false
    ),
    1,
    false,
    { includeDateHistory: false }
  );
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.partialSources, [{ source: 'romarr' }]);
  assert.equal(JSON.stringify(result).includes('private-api-key'), false);
});

it('reports providers that have not implemented exact platform release dates', async () => {
  configureProviders();
  await addSoftwareRequest({
    requestedById: 1,
    category: 'retro',
    catalogId: 46,
    platformName: 'PlayStation 4',
    platformId: 48,
  });
  mock.method(
    ROMarrNGAPI.prototype,
    'getCatalogGame',
    async (igdbId: number) => {
      const legacyGame = game(igdbId);
      delete legacyGame.platformReleaseDate;
      return legacyGame;
    }
  );

  const result = await getReleaseCalendar(
    parseCalendarQuery(
      { ...range, scope: 'all', mediaType: 'software' },
      true,
      false
    ),
    1,
    false,
    { includeDateHistory: false }
  );

  assert.deepEqual(result.results, []);
  assert.deepEqual(result.partialSources, [{ source: 'romarr' }]);
});
