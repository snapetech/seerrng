import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import GameLibraryAccount from '@server/entity/GameLibraryAccount';
import GameLibraryEntry from '@server/entity/GameLibraryEntry';
import {
  getSharedGameLibrary,
  markSteamOwnershipUnverified,
  normalizeGameTitle,
  SharedGameLibraryLimitError,
  syncSteamLibrary,
} from '@server/lib/gameLibrary';
import { setupTestDb } from '@server/test/db';

setupTestDb();

const createSteamAccount = async (userId = 2) =>
  getRepository(GameLibraryAccount).save(
    new GameLibraryAccount({
      userId,
      steamId: `7656119800000000${userId}`,
    })
  );

describe('personal game library sync and household privacy', () => {
  beforeEach(async () => {
    await createSteamAccount();
  });

  it('imports Steam ownership privately and preserves progress across later syncs', async () => {
    const firstSync = await syncSteamLibrary(2, [
      { appId: 10, name: 'Game One', playtimeMinutes: 60 },
    ]);
    assert.deepEqual(firstSync, { imported: 1, updated: 0, total: 1 });

    const repository = getRepository(GameLibraryEntry);
    let entry = await repository.findOneByOrFail({ userId: 2, steamAppId: 10 });
    assert.equal(entry.status, 'played');
    assert.equal(entry.steamOwned, true);
    assert.equal(entry.shareWithHousehold, false);
    assert.deepEqual(await getSharedGameLibrary(), []);

    entry.status = 'completed';
    entry.shareWithHousehold = true;
    await repository.save(entry);
    const secondSync = await syncSteamLibrary(2, [
      { appId: 10, name: 'Game One Updated', playtimeMinutes: 125 },
    ]);
    assert.deepEqual(secondSync, { imported: 0, updated: 1, total: 1 });

    entry = await repository.findOneByOrFail({ userId: 2, steamAppId: 10 });
    assert.equal(entry.status, 'completed');
    assert.equal(entry.playtimeMinutes, 125);
    assert.equal(entry.title, 'Game One Updated');
    assert.equal(entry.shareWithHousehold, true);

    const shared = await getSharedGameLibrary();
    assert.equal(shared.length, 1);
    assert.equal(shared[0].ownerCount, 1);
    assert.equal(shared[0].owners[0].displayName, 'friend');
    assert.equal(shared[0].owners[0].playtimeMinutes, 125);
  });

  it('normalizes accented and non-Latin titles without deleting their letters', () => {
    assert.equal(normalizeGameTitle('Café 東京'), 'cafe 東京');
  });

  it('bounds the number of shared entries loaded into memory', async () => {
    const repository = getRepository(GameLibraryEntry);
    await repository.save([
      new GameLibraryEntry({
        userId: 2,
        externalKey: 'manual:shared-limit-one',
        catalogId: null,
        category: 'game',
        title: 'Shared Game One',
        status: 'played',
        isOwned: true,
        steamAppId: null,
        steamOwned: false,
        playtimeMinutes: 0,
        storeName: 'Steam',
        platformName: '',
        shareWithHousehold: true,
        source: 'manual',
      }),
      new GameLibraryEntry({
        userId: 2,
        externalKey: 'manual:shared-limit-two',
        catalogId: null,
        category: 'game',
        title: 'Shared Game Two',
        status: 'played',
        isOwned: true,
        steamAppId: null,
        steamOwned: false,
        playtimeMinutes: 0,
        storeName: 'Steam',
        platformName: '',
        shareWithHousehold: true,
        source: 'manual',
      }),
    ]);

    await assert.rejects(
      () => getSharedGameLibrary(1),
      SharedGameLibraryLimitError
    );
  });

  it('does not automatically match imported Steam titles to a catalog title', async () => {
    const repository = getRepository(GameLibraryEntry);
    await repository.save(
      new GameLibraryEntry({
        userId: 2,
        externalKey: 'igdb:42',
        catalogId: 42,
        category: 'game',
        title: 'Same Game Name',
        status: 'backlog',
        isOwned: false,
        steamAppId: null,
        steamOwned: false,
        playtimeMinutes: 0,
        storeName: '',
        platformName: '',
        shareWithHousehold: false,
        source: 'manual',
      })
    );

    await syncSteamLibrary(2, [
      { appId: 42, name: 'Same Game Name', playtimeMinutes: 10 },
    ]);

    const entries = await repository.find({ where: { userId: 2 } });
    assert.equal(entries.length, 2);
    assert.equal(
      entries.find((entry) => entry.catalogId === 42)?.steamAppId,
      null
    );
    assert.equal(
      entries.find((entry) => entry.steamAppId === 42)?.catalogId,
      null
    );
  });

  it('removes stale Steam ownership and sharing when a title disappears or the account is unlinked', async () => {
    await syncSteamLibrary(2, [
      { appId: 10, name: 'Game One', playtimeMinutes: 240 },
    ]);
    const repository = getRepository(GameLibraryEntry);
    let entry = await repository.findOneByOrFail({ userId: 2, steamAppId: 10 });
    entry.shareWithHousehold = true;
    await repository.save(entry);

    await syncSteamLibrary(2, []);
    entry = await repository.findOneByOrFail({ userId: 2, steamAppId: 10 });
    assert.equal(entry.steamOwned, false);
    assert.equal(entry.shareWithHousehold, false);
    assert.equal(entry.playtimeMinutes, 240);

    entry.steamOwned = true;
    entry.shareWithHousehold = true;
    await repository.save(entry);
    await markSteamOwnershipUnverified(2);
    entry = await repository.findOneByOrFail({ userId: 2, steamAppId: 10 });
    assert.equal(entry.steamOwned, false);
    assert.equal(entry.shareWithHousehold, false);
    assert.equal(entry.storeName, '');
    assert.equal(entry.playtimeMinutes, 240);
  });

  it('keeps manually verified ownership and opt-in sharing when Steam is unlinked', async () => {
    await syncSteamLibrary(2, [
      { appId: 10, name: 'Game One', playtimeMinutes: 240 },
    ]);
    const repository = getRepository(GameLibraryEntry);
    const entry = await repository.findOneByOrFail({
      userId: 2,
      steamAppId: 10,
    });
    entry.isOwned = true;
    entry.shareWithHousehold = true;
    await repository.save(entry);

    await markSteamOwnershipUnverified(2);

    const updated = await repository.findOneByOrFail({
      userId: 2,
      steamAppId: 10,
    });
    assert.equal(updated.steamOwned, false);
    assert.equal(updated.isOwned, true);
    assert.equal(updated.shareWithHousehold, true);
    assert.equal(updated.storeName, 'Steam');
  });
});
