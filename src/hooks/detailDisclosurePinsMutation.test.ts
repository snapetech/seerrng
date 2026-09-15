import assert from 'node:assert/strict';
import test from 'node:test';
import { DetailDisclosurePinsMutationState } from './detailDisclosurePinsMutation';

const initialPins = {
  cast: false,
  crew: false,
  artists: false,
  subjectTags: false,
};

test('optimistically updates one detail disclosure pin without clearing others', () => {
  const state = new DetailDisclosurePinsMutationState();
  state.synchronize('user-1', { ...initialPins, cast: true });

  const mutation = state.begin('crew', true);

  assert.deepStrictEqual(mutation.next, {
    cast: true,
    crew: true,
    artists: false,
    subjectTags: false,
  });
});

test('does not roll back a newer detail disclosure pin mutation', () => {
  const state = new DetailDisclosurePinsMutationState();
  state.synchronize('user-1', initialPins);
  const stale = state.begin('cast', true);
  const current = state.begin('subjectTags', true);

  assert.strictEqual(state.rollback(stale), undefined);
  assert.deepStrictEqual(state.rollback(current), stale.next);
});

test('isolates detail disclosure pin mutations when the signed-in user changes', () => {
  const state = new DetailDisclosurePinsMutationState();
  state.synchronize('user-1', initialPins);
  const oldUserMutation = state.begin('cast', true);
  state.synchronize('user-2', initialPins);

  assert.strictEqual(state.isCurrent(oldUserMutation), false);
});
