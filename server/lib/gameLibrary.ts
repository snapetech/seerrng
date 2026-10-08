import type { SteamOwnedGame } from '@server/api/software/steam';
import dataSource, { getRepository } from '@server/datasource';
import GameLibraryAccount from '@server/entity/GameLibraryAccount';
import GameLibraryEntry, {
  type GameLibraryCategory,
  type GameLibraryStatus,
} from '@server/entity/GameLibraryEntry';
import { User } from '@server/entity/User';

export const GAME_LIBRARY_STATUSES: readonly GameLibraryStatus[] = [
  'backlog',
  'playing',
  'played',
  'completed',
  'paused',
  'dropped',
];

export const isGameLibraryCategory = (
  value: unknown
): value is GameLibraryCategory =>
  value === 'game' || value === 'retro' || value === 'modern';

export const isGameLibraryStatus = (
  value: unknown
): value is GameLibraryStatus =>
  GAME_LIBRARY_STATUSES.includes(value as GameLibraryStatus);

export const normalizeGameTitle = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const serializeGameLibraryEntry = (entry: GameLibraryEntry) => ({
  id: entry.id,
  externalKey: entry.externalKey,
  catalogId: entry.catalogId,
  category: entry.category,
  title: entry.title,
  summary: entry.summary,
  coverUrl: entry.coverUrl,
  releaseDate: entry.releaseDate,
  status: entry.status,
  isOwned: entry.isOwned,
  steamAppId: entry.steamAppId,
  steamOwned: entry.steamOwned,
  playtimeMinutes: entry.playtimeMinutes,
  storeName: entry.storeName,
  platformName: entry.platformName,
  shareWithHousehold: entry.shareWithHousehold,
  source: entry.source,
  lastSyncedAt: entry.lastSyncedAt,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
});

export const syncSteamLibrary = async (
  userId: number,
  steamGames: SteamOwnedGame[],
  syncedAt = new Date()
): Promise<{ imported: number; updated: number; total: number }> =>
  dataSource.transaction(async (manager) => {
    const accountRepository = manager.getRepository(GameLibraryAccount);
    const account = await accountRepository.findOneBy({ userId });
    if (!account) throw new Error('Steam account is not linked.');

    const entries = await manager.getRepository(GameLibraryEntry).find({
      where: { userId },
    });
    const bySteamId = new Map(
      entries
        .filter((entry) => entry.steamAppId !== null)
        .map((entry) => [entry.steamAppId!, entry])
    );
    const changed = new Map<number, GameLibraryEntry>();
    const newlyCreated: GameLibraryEntry[] = [];
    const seenSteamIds = new Set<number>();
    let updated = 0;

    for (const game of steamGames) {
      seenSteamIds.add(game.appId);
      let entry = bySteamId.get(game.appId);

      if (entry) {
        entry.steamAppId = game.appId;
        entry.steamOwned = true;
        entry.playtimeMinutes = game.playtimeMinutes;
        entry.lastSyncedAt = syncedAt;
        if (!entry.storeName) entry.storeName = 'Steam';
        if (entry.source === 'steam') {
          entry.title = game.name;
          if (entry.playtimeMinutes > 0 && entry.status === 'backlog') {
            entry.status = 'played';
          }
        }
        changed.set(entry.id, entry);
        updated += 1;
        continue;
      }

      entry = new GameLibraryEntry({
        userId,
        externalKey: `steam:${game.appId}`,
        catalogId: null,
        category: 'game',
        title: game.name,
        summary: '',
        coverUrl: '',
        releaseDate: '',
        status: game.playtimeMinutes > 0 ? 'played' : 'backlog',
        isOwned: false,
        steamAppId: game.appId,
        steamOwned: true,
        playtimeMinutes: game.playtimeMinutes,
        storeName: 'Steam',
        platformName: 'PC',
        shareWithHousehold: false,
        source: 'steam',
        lastSyncedAt: syncedAt,
      });
      newlyCreated.push(entry);
      bySteamId.set(game.appId, entry);
    }

    for (const entry of entries) {
      if (
        entry.steamAppId !== null &&
        !seenSteamIds.has(entry.steamAppId) &&
        entry.steamOwned
      ) {
        entry.steamOwned = false;
        if (!entry.isOwned) {
          entry.shareWithHousehold = false;
          if (entry.source === 'steam') entry.storeName = '';
        }
        entry.lastSyncedAt = syncedAt;
        changed.set(entry.id, entry);
        updated += 1;
      }
    }

    if (changed.size) {
      await manager.getRepository(GameLibraryEntry).save([...changed.values()]);
    }
    if (newlyCreated.length) {
      await manager.getRepository(GameLibraryEntry).save(newlyCreated, {
        chunk: 250,
      });
    }
    account.lastSyncCount = steamGames.length;
    account.lastSyncedAt = syncedAt;
    await accountRepository.save(account);

    return {
      imported: newlyCreated.length,
      updated,
      total: steamGames.length,
    };
  });

export const markSteamOwnershipUnverified = async (
  userId: number
): Promise<void> => {
  await dataSource.transaction(async (manager) => {
    const repository = manager.getRepository(GameLibraryEntry);
    const entries = await repository.find({
      where: { userId, steamOwned: true },
    });
    for (const entry of entries) {
      entry.steamOwned = false;
      if (!entry.isOwned) {
        entry.shareWithHousehold = false;
        if (entry.source === 'steam') entry.storeName = '';
      }
    }
    if (entries.length) await repository.save(entries, { chunk: 250 });
  });
};

export interface SharedGameOwner {
  id: number;
  displayName: string;
  avatar: string;
  status: GameLibraryStatus;
  storeName: string;
  platformName: string;
  playtimeMinutes: number;
}

export interface SharedGame {
  key: string;
  catalogId: number | null;
  category: GameLibraryCategory;
  title: string;
  summary: string;
  coverUrl: string;
  owners: SharedGameOwner[];
  ownerCount: number;
  steamAppId: number | null;
  playtimeMinutes: number;
}

export const MAX_SHARED_GAME_ENTRIES = 20_000;

export class SharedGameLibraryLimitError extends Error {
  constructor() {
    super(
      'The household game library exceeds the supported shared-entry limit.'
    );
    this.name = 'SharedGameLibraryLimitError';
  }
}

const sharedGameKey = (entry: GameLibraryEntry): string => {
  if (entry.catalogId !== null) return `igdb:${entry.catalogId}`;
  if (entry.steamAppId !== null) return `steam:${entry.steamAppId}`;
  return `title:${entry.category}:${normalizeGameTitle(entry.title)}`;
};

export const getSharedGameLibrary = async (
  maxEntries = MAX_SHARED_GAME_ENTRIES
): Promise<SharedGame[]> => {
  const entries = await getRepository(GameLibraryEntry)
    .createQueryBuilder('entry')
    .innerJoinAndMapOne('entry.user', User, 'owner', 'owner.id = entry.userId')
    .addSelect(['owner.id', 'owner.username', 'owner.avatar'])
    .where('entry.shareWithHousehold = :shared', { shared: true })
    .andWhere('(entry.isOwned = :owned OR entry.steamOwned = :owned)', {
      owned: true,
    })
    .orderBy('entry.title', 'ASC')
    .take(maxEntries + 1)
    .getMany();

  if (entries.length > maxEntries) throw new SharedGameLibraryLimitError();

  const grouped = new Map<string, SharedGame & { ownerIds: Set<number> }>();
  for (const entry of entries) {
    const owner = entry.user;
    if (!owner) continue;
    const key = sharedGameKey(entry);
    const game = grouped.get(key) ?? {
      key,
      catalogId: entry.catalogId,
      category: entry.category,
      title: entry.title,
      summary: entry.summary,
      coverUrl: entry.coverUrl,
      owners: [],
      ownerCount: 0,
      steamAppId: entry.steamAppId,
      playtimeMinutes: 0,
      ownerIds: new Set<number>(),
    };
    if (entry.catalogId !== null && game.catalogId === null) {
      game.catalogId = entry.catalogId;
      game.category = entry.category;
      game.title = entry.title;
      game.summary = entry.summary;
      game.coverUrl = entry.coverUrl;
    }
    if (!game.ownerIds.has(owner.id)) {
      game.ownerIds.add(owner.id);
      game.owners.push({
        id: owner.id,
        displayName: owner.username || `User ${owner.id}`,
        avatar: owner.avatar,
        status: entry.status,
        storeName: entry.steamOwned ? 'Steam' : entry.storeName,
        platformName: entry.platformName,
        playtimeMinutes: entry.playtimeMinutes,
      });
      game.ownerCount += 1;
      game.playtimeMinutes += entry.playtimeMinutes;
    }
    if (game.steamAppId === null) game.steamAppId = entry.steamAppId;
    grouped.set(key, game);
  }

  return [...grouped.values()]
    .map(({ ownerIds: _ownerIds, ...game }) => game)
    .sort(
      (left, right) =>
        right.ownerCount - left.ownerCount ||
        left.title.localeCompare(right.title)
    );
};
