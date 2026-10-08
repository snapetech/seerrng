// Copyright (c) snapetech and SeerrNG contributors.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coordinate,
  preparePlan,
} from '../tools/validation-engine/runtime/controller.mjs';
import { effectiveDependencies } from '../tools/validation-engine/runtime/priority.mjs';

const candidate = {
  repository: 'Example/seerr',
  commit: 'a'.repeat(40),
  tree: 'b'.repeat(40),
  lockSha256: 'c'.repeat(64),
};
const lane = (id, fields = {}) => ({
  id,
  kind: 'check',
  required: true,
  dependsOn: [],
  ...fields,
});
const unit = (id, laneId, fields = {}) => ({
  id,
  lane: laneId,
  slots: 1,
  reads: [],
  writes: [],
  files: [],
  dependsOn: [],
  ...fields,
});
const plan = (lanes, units) => ({
  runId: 'completion-order-fixture',
  candidate,
  maxSlots: 4,
  lanes,
  units,
});
const receipt = (context, status = 'passed') => ({
  ...context,
  status,
  cases: { passed: 0, failed: 0, skipped: 0 },
});
const run = (input, executor, fields = {}) =>
  coordinate(input, {
    execute: true,
    executor,
    includeCompile: true,
    allowDeclaredWrites: true,
    ...fields,
  });

test('completed failure permits ordered independent work without changing successful dependencies or overall failure', async () => {
  const input = plan(
    [
      lane('repository'),
      lane('codeql', { after: ['repository'] }),
      lane('build', { after: ['codeql'] }),
      lane('browser', { after: ['build'] }),
    ],
    [
      unit('repo', 'repository'),
      unit('ql', 'codeql'),
      unit('build', 'build'),
      unit('browser', 'browser', { dependsOn: ['build'] }),
    ]
  );
  const calls = [];
  const result = await run(input, async (value, context) => {
    calls.push(value.id);
    return receipt(context, value.id === 'repo' ? 'failed' : 'passed');
  });
  assert.deepEqual(calls, ['repo', 'ql', 'build', 'browser']);
  assert.equal(result.status, 'failed');
  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, 'failed');
  const failedBuild = await run(input, async (value, context) =>
    receipt(context, ['repo', 'build'].includes(value.id) ? 'failed' : 'passed')
  );
  assert.deepEqual(
    failedBuild.results.map((value) => value.status),
    ['failed', 'passed', 'failed', 'blocked']
  );
});

test('failed aggregate lane is not completed while any other producer is active', async () => {
  let release;
  let started;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const active = new Promise((resolve) => {
    started = resolve;
  });
  const calls = [];
  const input = plan(
    [lane('first'), lane('second', { after: ['first'] })],
    [unit('failed', 'first'), unit('held', 'first'), unit('next', 'second')]
  );
  const pending = run(input, async (value, context) => {
    calls.push(value.id);
    if (value.id === 'held') {
      started();
      await held;
    }
    return receipt(context, value.id === 'failed' ? 'failed' : 'passed');
  });
  await active;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['failed', 'held']);
  release();
  const result = await pending;
  assert.deepEqual(calls, ['failed', 'held', 'next']);
  const producerEnd = Math.max(
    ...result.results.slice(0, 2).map((value) => value.endOffsetMs)
  );
  assert.ok(result.results[2].startOffsetMs >= producerEnd);
  assert.equal(result.status, 'failed');
});

test('queued producer is not completed when an earlier producer already failed', async () => {
  const input = plan(
    [lane('first'), lane('second', { after: ['first'] })],
    [unit('failed', 'first'), unit('queued', 'first'), unit('next', 'second')]
  );
  input.maxSlots = 1;
  const calls = [];
  const result = await run(input, async (value, context) => {
    calls.push(value.id);
    return receipt(context, value.id === 'failed' ? 'failed' : 'passed');
  });
  assert.deepEqual(calls, ['failed', 'queued', 'next']);
  assert.equal(result.ok, false);
});

test('unit after edges sequence completion but retain failure, whereas dependsOn requires success', async () => {
  const input = plan(
    [lane('checks')],
    [
      unit('first', 'checks'),
      unit('independent', 'checks', { after: ['first'] }),
      unit('dependent', 'checks', { dependsOn: ['first'] }),
    ]
  );
  const calls = [];
  const result = await run(input, async (value, context) => {
    calls.push(value.id);
    return receipt(context, value.id === 'first' ? 'failed' : 'passed');
  });
  assert.deepEqual(calls, ['first', 'independent']);
  assert.deepEqual(
    result.results.map((value) => value.status),
    ['failed', 'passed', 'blocked']
  );
});

test('missing prerequisites finish without invented execution and do not block independent completion ordering', async () => {
  const input = plan(
    [
      lane('first', {
        prerequisites: [
          {
            id: 'missing',
            status: 'pending',
            reason: 'Native prerequisite missing',
          },
        ],
      }),
      lane('second', { after: ['first'] }),
    ],
    [unit('first', 'first'), unit('second', 'second')]
  );
  const calls = [];
  const result = await run(input, async (value, context) => {
    calls.push(value.id);
    return receipt(context);
  });
  assert.deepEqual(calls, ['second']);
  assert.equal(result.results[0].executed, false);
  assert.equal(result.results[0].status, 'pending-prerequisite');
  assert.equal(result.ok, false);
});

test('abort prevents later work even when the completion barrier becomes terminal', async () => {
  const controller = new AbortController();
  const input = plan(
    [lane('first'), lane('second', { after: ['first'] })],
    [unit('first', 'first'), unit('second', 'second')]
  );
  const calls = [];
  const result = await run(
    input,
    async (value, context) => {
      calls.push(value.id);
      controller.abort();
      return receipt(context, 'failed');
    },
    { signal: controller.signal }
  );
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(
    result.results.map((value) => value.status),
    ['cancelled', 'cancelled']
  );
  assert.equal(result.ok, false);
});

test('unknown, duplicate and mixed completion/data dependency cycles fail before execution', () => {
  for (const input of [
    plan([lane('first', { after: ['unknown'] })], [unit('first', 'first')]),
    plan([lane('first')], [unit('first', 'first', { after: ['unknown'] })]),
    plan(
      [lane('first')],
      [unit('first', 'first', { after: ['first', 'first'] })]
    ),
    plan(
      [lane('first')],
      [
        unit('first', 'first', { after: ['second'] }),
        unit('second', 'first', { dependsOn: ['first'] }),
      ]
    ),
    plan(
      [lane('first', { after: ['second'] }), lane('second')],
      [
        unit('first', 'first'),
        unit('second', 'second', { dependsOn: ['first'] }),
      ]
    ),
    plan([lane('first', { after: ['first'] })], [unit('first', 'first')]),
  ])
    assert.throws(() => preparePlan(input), /unknown|duplicate|cycle/);
});

test('priority metadata includes both declared success and completion DAG edges without invented costs', () => {
  const prepared = preparePlan(
    plan(
      [lane('first'), lane('second', { after: ['first'] })],
      [
        unit('first', 'first'),
        unit('second', 'second'),
        unit('third', 'second', { after: ['second'] }),
      ]
    )
  );
  const dependencies = effectiveDependencies(prepared);
  assert.deepEqual(dependencies.get('second'), ['first']);
  assert.deepEqual(
    new Set(dependencies.get('third')),
    new Set(['second', 'first'])
  );
  assert.ok(prepared.units.every((value) => value.cost === undefined));
});
