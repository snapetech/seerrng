import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestStatusPageItem } from './requestStatus';
import {
  parseRequestStatusSort,
  sortRequestStatusItems,
} from './requestStatusSort';

const item = (
  id: number,
  stage: string,
  createdAt = `2026-01-0${id}T00:00:00.000Z`
): RequestStatusPageItem =>
  ({
    request: {
      id,
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    },
    status: { stage },
  }) as RequestStatusPageItem;

test('request status sort defaults to newest requests', () => {
  assert.deepStrictEqual(parseRequestStatusSort(), {
    field: 'added',
    direction: 'desc',
  });
  assert.deepStrictEqual(parseRequestStatusSort('status', 'asc'), {
    field: 'status',
    direction: 'asc',
  });
  assert.deepStrictEqual(parseRequestStatusSort('not-a-field', 'sideways'), {
    field: 'added',
    direction: 'desc',
  });
});

test('sorts status projections by live lifecycle stage', async () => {
  const requests = [
    item(1, 'available'),
    item(2, 'requested'),
    item(3, 'downloading'),
  ];

  const sorted = await sortRequestStatusItems(requests, 'status', 'asc');

  assert.deepStrictEqual(
    sorted.map(({ request }) => request.id),
    [2, 3, 1]
  );
});

test('sorts metadata fields across all media types with deterministic fallbacks', async () => {
  const requests = [
    item(1, 'approved'),
    item(2, 'approved'),
    item(3, 'approved'),
  ];
  const titles = new Map([
    [1, 'Zeta'],
    [2, 'Alpha'],
    [3, 'Alpha'],
  ]);

  const sorted = await sortRequestStatusItems(
    requests,
    'title',
    'asc',
    async ({ request }) => ({ title: titles.get(request.id) })
  );

  assert.deepStrictEqual(
    sorted.map(({ request }) => request.id),
    [2, 3, 1]
  );
});
