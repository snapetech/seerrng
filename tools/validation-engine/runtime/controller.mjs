// Existing reviewed validation-engine controller, bound into the application.
import { performance } from 'node:perf_hooks';
import {
  orderReadyUnits,
  schedulingMetadata,
  validatePriority,
} from './priority.mjs';

// Derived scheduling principles from the reviewed repair-queue prototype:
// reserve all file locks atomically; allow independent work to bypass a wait;
// do not starve a ready earlier writer. No spawn, filesystem write or repair.
const HASH40 = /^[a-f0-9]{40}$/;
const HASH64 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KINDS = new Set(['test', 'check', 'prerequisite', 'compile', 'manual']);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`invalid ${label}`);
  return value;
}

// Logical canonical source-relative keys only. Realpath/symlink and filesystem
// case identity must already be proved by the source manifest. No alias probing.
export function resourceKey(value, caseSensitive = true) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.trim() !== value ||
    // eslint-disable-next-line no-control-regex -- Reject unsafe control characters in source-relative resource keys.
    /[\\:*?"<>|\x00-\x1f\x7f]/.test(value) ||
    value.normalize('NFC') !== value ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//')
  )
    throw new Error('unsafe resource key');
  const parts = value.split('/');
  if (
    parts.some(
      (part) =>
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
  ) {
    throw new Error('ambiguous resource key');
  }
  return caseSensitive ? value : value.toLowerCase();
}

function list(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an explicit string array`);
  }
  if (new Set(value).size !== value.length)
    throw new Error(`duplicate ${label}`);
  return value;
}

export function preparePlan(input) {
  const plan = structuredClone(input);
  identifier(plan.runId, 'run ID');
  const candidate = plan.candidate;
  if (
    !candidate ||
    typeof candidate.repository !== 'string' ||
    !candidate.repository.trim() ||
    !HASH40.test(candidate.commit) ||
    !HASH40.test(candidate.tree) ||
    !HASH64.test(candidate.lockSha256)
  )
    throw new Error('exact candidate identity required');
  if (
    plan.executionEnvironmentSha256 !== undefined &&
    !HASH64.test(plan.executionEnvironmentSha256)
  )
    throw new Error('invalid execution environment identity');
  if (
    !Number.isInteger(plan.maxSlots) ||
    plan.maxSlots < 1 ||
    plan.maxSlots > 256
  ) {
    throw new Error('maxSlots must be an integer from 1 through 256');
  }
  plan.caseSensitive ??= true;
  if (typeof plan.caseSensitive !== 'boolean')
    throw new Error('caseSensitive must be boolean');
  if (!Array.isArray(plan.lanes) || !Array.isArray(plan.units))
    throw new Error('lanes and units required');
  const lanes = new Map();
  for (const lane of plan.lanes) {
    identifier(lane.id, 'lane ID');
    if (lanes.has(lane.id) || !KINDS.has(lane.kind))
      throw new Error('duplicate lane or invalid kind');
    lane.required ??= lane.kind !== 'compile';
    if (typeof lane.required !== 'boolean')
      throw new Error('lane required must be boolean');
    lane.dependsOn = list(lane.dependsOn ?? [], 'lane dependencies');
    lane.after = list(lane.after ?? [], 'lane completion order');
    lane.prerequisites ??= [];
    if (!Array.isArray(lane.prerequisites))
      throw new Error('prerequisites must be an array');
    const keys = new Set();
    for (const prerequisite of lane.prerequisites) {
      identifier(prerequisite.id, 'prerequisite ID');
      if (keys.has(prerequisite.id)) throw new Error('duplicate prerequisite');
      keys.add(prerequisite.id);
      if (prerequisite.status === 'ready') {
        if (!HASH64.test(prerequisite.evidenceSha256))
          throw new Error('ready prerequisite needs evidence hash');
      } else if (
        prerequisite.status !== 'pending' ||
        typeof prerequisite.reason !== 'string' ||
        !prerequisite.reason.trim()
      )
        throw new Error('explicit pending prerequisite required');
    }
    lanes.set(lane.id, lane);
  }
  const units = new Map();
  for (const unit of plan.units) {
    identifier(unit.id, 'unit ID');
    if (units.has(unit.id) || !lanes.has(unit.lane))
      throw new Error('duplicate unit or unknown lane');
    if (
      !Number.isInteger(unit.slots) ||
      unit.slots < 1 ||
      unit.slots > plan.maxSlots
    ) {
      throw new Error('unit slot demand exceeds hard budget');
    }
    unit.dependsOn = list(unit.dependsOn ?? [], 'unit dependencies');
    unit.after = list(unit.after ?? [], 'unit completion order');
    for (const field of ['reads', 'writes', 'files']) {
      unit[field] = list(unit[field], field).map((key) =>
        resourceKey(key, plan.caseSensitive)
      );
      if (new Set(unit[field]).size !== unit[field].length)
        throw new Error(`aliased ${field}`);
    }
    const writes = new Set(unit.writes);
    unit.reads = unit.reads.filter((key) => !writes.has(key));
    if (unit.validationInputs?.complete === true) {
      if (!HASH64.test(unit.validationInputs.contractSha256))
        throw new Error(
          'complete validation inputs need command/setup contract digest'
        );
      unit.validationInputs.paths = list(
        unit.validationInputs.paths,
        'validation input paths'
      ).map((key) => resourceKey(key, plan.caseSensitive));
      if (
        new Set(unit.validationInputs.paths).size !==
        unit.validationInputs.paths.length
      )
        throw new Error('aliased validation input paths');
      if (
        [...unit.reads, ...unit.files].some(
          (key) => !unit.validationInputs.paths.includes(key)
        )
      )
        throw new Error('complete validation contract omits read/test file');
    }
    units.set(unit.id, unit);
  }
  for (const lane of lanes.values()) {
    if (lane.dependsOn.some((id) => !lanes.has(id)))
      throw new Error('unknown lane dependency');
    if (lane.after.some((id) => !lanes.has(id)))
      throw new Error('unknown lane completion order');
  }
  for (const unit of units.values()) {
    if (unit.dependsOn.some((id) => !units.has(id)))
      throw new Error('unknown unit dependency');
    if (unit.after.some((id) => !units.has(id)))
      throw new Error('unknown unit completion order');
  }
  // Lane completion depends on its units; units depend on declared parent
  // lanes and other units. Detect mixed lane/unit cycles BEFORE an executor.
  const graph = new Map();
  for (const lane of lanes.values()) {
    graph.set(
      `l:${lane.id}`,
      [...units.values()]
        .filter((u) => u.lane === lane.id)
        .map((u) => `u:${u.id}`)
    );
    graph
      .get(`l:${lane.id}`)
      .push(...[...lane.dependsOn, ...lane.after].map((id) => `l:${id}`));
  }
  for (const unit of units.values()) {
    graph.set(`u:${unit.id}`, [
      ...[...unit.dependsOn, ...unit.after].map((id) => `u:${id}`),
      ...[...lanes.get(unit.lane).dependsOn, ...lanes.get(unit.lane).after].map(
        (id) => `l:${id}`
      ),
    ]);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    graph.get(id).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  graph.forEach((_, id) => visit(id));
  validatePriority(plan);
  return freeze(plan);
}

function conflicts(a, b) {
  return (
    a.writes.some((key) => b.writes.includes(key) || b.reads.includes(key)) ||
    a.reads.some((key) => b.writes.includes(key))
  );
}

function cases(value) {
  if (
    !value ||
    !['passed', 'failed', 'skipped'].every(
      (key) => Number.isSafeInteger(value[key]) && value[key] >= 0
    )
  ) {
    throw new Error('executor must report safe case-attempt counts');
  }
  if (!Number.isSafeInteger(value.passed + value.failed + value.skipped))
    throw new Error('case-attempt total overflow');
  return { passed: value.passed, failed: value.failed, skipped: value.skipped };
}

function addCounts(target, incoming) {
  for (const key of Object.keys(target)) {
    const next = target[key] + (incoming?.[key] ?? 0);
    if (!Number.isSafeInteger(next))
      throw new Error('aggregate case-attempt overflow');
    target[key] = next;
  }
  if (!Number.isSafeInteger(target.passed + target.failed + target.skipped))
    throw new Error('aggregate case-attempt total overflow');
  return target;
}

export async function coordinate(
  input,
  {
    execute = false,
    executor,
    includeCompile = false,
    allowDeclaredWrites = false,
    signal,
  } = {}
) {
  const plan = preparePlan(input);
  const priority = schedulingMetadata(plan);
  let lastSetupClass = null;
  if (execute && typeof executor !== 'function')
    throw new Error('execution needs injected executor');
  const began = performance.now();
  const records = new Map(
    plan.units.map((unit) => [
      unit.id,
      {
        id: unit.id,
        lane: unit.lane,
        slots: unit.slots,
        files: [...unit.files],
        runId: plan.runId,
        candidate: plan.candidate,
        contractSha256: null,
        inputHashes: null,
        executionEnvironmentSha256: plan.executionEnvironmentSha256 ?? null,
        status: execute ? 'queued' : 'planned',
        reason: null,
        executed: false,
        wallMs: null,
        cpuMs: null,
        caseAttempts: null,
        startOffsetMs: null,
        endOffsetMs: null,
        scheduling: priority.get(unit.id),
      },
    ])
  );
  const laneById = new Map(plan.lanes.map((lane) => [lane.id, lane]));
  const active = new Map();
  const stats = {
    unitsQueued: execute ? plan.units.length : 0,
    unitsExecuted: 0,
    activeUnits: 0,
    peakActiveUnits: 0,
    reservedSlots: 0,
    peakReservedSlots: 0,
    configuredSlotCap: plan.maxSlots,
    caseAttempts: { passed: 0, failed: 0, skipped: 0 },
    selectedFileCount: new Set(plan.units.flatMap((u) => u.files)).size,
    executedFileCount: 0,
    osThreads: null,
    childCpuMs: null,
  };
  const laneStatus = (lane) => {
    if (lane.kind === 'compile' && !includeCompile) return 'not-selected';
    if (lane.prerequisites.some((p) => p.status === 'pending'))
      return 'pending-prerequisite';
    const states = plan.units
      .filter((u) => u.lane === lane.id)
      .map((u) => records.get(u.id).status);
    if (!states.length) return 'pending-prerequisite'; // discovery is not execution
    if (states.includes('failed')) return 'failed';
    if (states.includes('active')) return 'active';
    if (states.includes('queued')) return 'queued';
    if (states.includes('blocked') || states.includes('cancelled'))
      return 'blocked';
    if (states.includes('pending-prerequisite')) return 'pending-prerequisite';
    return states.every((s) => s === 'passed') ? 'passed' : 'planned';
  };
  const dependencies = (unit) => [
    ...unit.dependsOn.map((id) => ({
      id: `unit:${id}`,
      status: records.get(id).status,
    })),
    ...laneById.get(unit.lane).dependsOn.map((id) => ({
      id: `lane:${id}`,
      status: laneStatus(laneById.get(id)),
    })),
  ];
  // Ordering is not a success/data dependency. Inspect every producer record,
  // because a lane's aggregate status can be failed while another unit is active.
  const terminal = (record) =>
    [
      'passed',
      'failed',
      'blocked',
      'cancelled',
      'not-selected',
      'pending-prerequisite',
    ].includes(record.status);
  const completedOrder = (unit) =>
    unit.after.every((id) => terminal(records.get(id))) &&
    laneById.get(unit.lane).after.every((id) => {
      const producers = plan.units.filter((producer) => producer.lane === id);
      return producers.every((producer) => terminal(records.get(producer.id)));
    });
  if (execute) {
    for (const unit of plan.units) {
      const record = records.get(unit.id);
      const lane = laneById.get(unit.lane);
      if (lane.kind === 'compile' && !includeCompile) {
        record.status = 'not-selected';
        record.reason = 'compilation is a separate optional action';
      } else if (lane.prerequisites.some((p) => p.status === 'pending')) {
        record.status = 'pending-prerequisite';
        record.reason = lane.prerequisites
          .filter((p) => p.status === 'pending')
          .map((p) => `${p.id}: ${p.reason}`)
          .join('; ');
      } else if (unit.writes.length && !allowDeclaredWrites) {
        record.status = 'pending-prerequisite';
        record.reason = 'declared writer authority not enabled';
      }
    }
  }
  const ready = (unit) =>
    records.get(unit.id).status === 'queued' &&
    dependencies(unit).every((dep) => dep.status === 'passed') &&
    completedOrder(unit);
  const executeUnit = async (unit) => {
    const record = records.get(unit.id);
    const start = performance.now();
    record.status = 'active';
    record.executed = true;
    record.startOffsetMs = start - began;
    stats.unitsExecuted++;
    try {
      const receipt = await executor(
        unit,
        freeze({
          runId: plan.runId,
          candidate: plan.candidate,
          ...(plan.executionEnvironmentSha256
            ? { executionEnvironmentSha256: plan.executionEnvironmentSha256 }
            : {}),
        }),
        signal
      );
      if (
        !receipt ||
        receipt.runId !== plan.runId ||
        !receipt.candidate ||
        ['repository', 'commit', 'tree', 'lockSha256'].some(
          (key) => receipt.candidate[key] !== plan.candidate[key]
        )
      ) {
        throw new Error('executor receipt identity mismatch');
      }
      if (
        plan.executionEnvironmentSha256 &&
        receipt.executionEnvironmentSha256 !== plan.executionEnvironmentSha256
      )
        throw new Error('executor environment identity mismatch');
      record.caseAttempts = cases(receipt.cases);
      if (
        laneById.get(unit.lane).kind === 'test' &&
        record.caseAttempts.passed + record.caseAttempts.failed < 1
      ) {
        throw new Error('test unit executed zero active cases');
      }
      if (!['passed', 'failed'].includes(receipt.status))
        throw new Error('executor must report passed or failed');
      if (
        receipt.cpuMs !== undefined &&
        receipt.cpuMs !== null &&
        (!Number.isFinite(receipt.cpuMs) || receipt.cpuMs < 0)
      )
        throw new Error('invalid measured CPU time');
      record.cpuMs = receipt.cpuMs ?? null;
      record.status = signal?.aborted
        ? 'cancelled'
        : receipt.status === 'passed' && record.caseAttempts.failed === 0
          ? 'passed'
          : 'failed';
      record.reason =
        typeof receipt.reason === 'string' ? receipt.reason : null;
      if (receipt.evidenceSha256 !== undefined) {
        if (!HASH64.test(receipt.evidenceSha256))
          throw new Error('invalid evidence digest');
        record.evidenceSha256 = receipt.evidenceSha256;
      }
      if (unit.validationInputs?.complete === true) {
        if (
          receipt.contractSha256 !== unit.validationInputs.contractSha256 ||
          !receipt.inputHashes ||
          typeof receipt.inputHashes !== 'object' ||
          Array.isArray(receipt.inputHashes)
        )
          throw new Error('executor input/command contract proof missing');
        const hashes = {};
        for (const [path, digest] of Object.entries(receipt.inputHashes)) {
          const key = resourceKey(path, plan.caseSensitive);
          if (Object.hasOwn(hashes, key) || !HASH64.test(digest))
            throw new Error('invalid/aliased executor input digest');
          hashes[key] = digest;
        }
        if (
          unit.validationInputs.paths.some(
            (path) => !Object.hasOwn(hashes, path)
          )
        )
          throw new Error('executor omits declared input digest');
        record.contractSha256 = receipt.contractSha256;
        record.inputHashes = hashes;
      }
    } catch (error) {
      record.status = 'failed';
      record.reason = error.message;
    } finally {
      record.wallMs = performance.now() - start;
      record.endOffsetMs = performance.now() - began;
      active.delete(unit.id);
      stats.activeUnits = active.size;
      stats.reservedSlots -= unit.slots;
    }
  };
  while (
    execute &&
    (active.size || [...records.values()].some((r) => r.status === 'queued'))
  ) {
    let changed;
    do {
      changed = false;
      for (const unit of plan.units) {
        const record = records.get(unit.id);
        if (record.status !== 'queued') continue;
        const deps = dependencies(unit);
        const failed = deps.filter((d) =>
          ['failed', 'blocked', 'cancelled', 'not-selected'].includes(d.status)
        );
        const pending = deps.filter((d) => d.status === 'pending-prerequisite');
        if (signal?.aborted || failed.length || pending.length) {
          record.status = signal?.aborted
            ? 'cancelled'
            : failed.length
              ? 'blocked'
              : 'pending-prerequisite';
          record.reason = signal?.aborted
            ? 'run aborted'
            : [...failed, ...pending]
                .map((d) => `${d.id}:${d.status}`)
                .join('; ');
          changed = true;
        }
      }
    } while (changed);
    const readyUnits = orderReadyUnits(
      plan,
      plan.units.filter(ready),
      priority,
      lastSetupClass
    );
    for (let index = 0; index < readyUnits.length; index++) {
      const unit = readyUnits[index];
      if (signal?.aborted || stats.reservedSlots + unit.slots > plan.maxSlots)
        continue;
      // Earlier READY conflicting jobs retain priority, but missing dependency
      // jobs reserve no lock and cannot block the work they need to finish.
      if (
        [...active.values()].some((entry) => conflicts(unit, entry.unit)) ||
        plan.units
          .slice(0, plan.units.indexOf(unit))
          .some((other) => ready(other) && conflicts(unit, other))
      )
        continue;
      const reservation = { unit, promise: null };
      active.set(unit.id, reservation);
      stats.activeUnits = active.size;
      stats.peakActiveUnits = Math.max(stats.peakActiveUnits, active.size);
      stats.reservedSlots += unit.slots;
      stats.peakReservedSlots = Math.max(
        stats.peakReservedSlots,
        stats.reservedSlots
      );
      if (['heavy', 'light'].includes(priority.get(unit.id).setupClass))
        lastSetupClass = priority.get(unit.id).setupClass;
      reservation.promise = executeUnit(unit);
    }
    if (active.size)
      await Promise.race([...active.values()].map((r) => r.promise));
    else if ([...records.values()].some((r) => r.status === 'queued')) {
      throw new Error('unresolved admission deadlock');
    }
  }
  const results = [...records.values()];
  const lanes = plan.lanes.map((lane) => {
    const units = results.filter((r) => r.lane === lane.id);
    const executedUnits = units.filter((r) => r.executed);
    const cpuKnown =
      executedUnits.length && executedUnits.every((r) => r.cpuMs !== null);
    return {
      id: lane.id,
      kind: lane.kind,
      required: lane.required,
      status: laneStatus(lane),
      unitCount: units.length,
      unitsExecuted: executedUnits.length,
      unitWallMs: executedUnits.reduce((sum, r) => sum + r.wallMs, 0),
      spanWallMs: executedUnits.length
        ? Math.max(...executedUnits.map((r) => r.endOffsetMs)) -
          Math.min(...executedUnits.map((r) => r.startOffsetMs))
        : null,
      cpuMs: cpuKnown
        ? executedUnits.reduce((sum, r) => sum + r.cpuMs, 0)
        : null,
      caseAttempts: executedUnits.reduce(
        (sum, r) => addCounts(sum, r.caseAttempts),
        { passed: 0, failed: 0, skipped: 0 }
      ),
    };
  });
  for (const lane of lanes) addCounts(stats.caseAttempts, lane.caseAttempts);
  stats.executedFileCount = new Set(
    results.filter((r) => r.executed).flatMap((r) => r.files)
  ).size;
  stats.childCpuMs =
    results.some((r) => r.executed) &&
    results.filter((r) => r.executed).every((r) => r.cpuMs !== null)
      ? results.reduce((sum, r) => sum + (r.cpuMs ?? 0), 0)
      : null;
  stats.wallMs = performance.now() - began;
  const required = lanes.filter((lane) => lane.required);
  const ok =
    execute &&
    required.length > 0 &&
    required.every((lane) => lane.status === 'passed') &&
    !results.some((r) => ['failed', 'cancelled'].includes(r.status));
  const status = !execute
    ? 'planned'
    : ok
      ? 'passed'
      : lanes.some((l) => ['failed', 'blocked'].includes(l.status))
        ? 'failed'
        : 'incomplete';
  return {
    schemaVersion: 2,
    runId: plan.runId,
    candidate: plan.candidate,
    executionEnvironmentSha256: plan.executionEnvironmentSha256 ?? null,
    mode: execute ? 'execute' : 'plan',
    status,
    ok,
    stats,
    lanes,
    results,
    limitations: [
      'logical single-process locks, not a sandbox or OS locks',
      'executor must enforce immutable source, isolated fixtures and process cancellation',
      'declared slot demand is a hard admission budget, not measured OS threads',
      'caseAttempts are summed attempts, not deduplicated case identities',
      'priority uses declared DAG edges and explicit cost/setup evidence, never invented duration',
      'finite frozen queue; priority cannot discover undeclared impact or guarantee zero idle/tail latency',
      'unavailable child CPU measurements remain null, never wall-time estimates',
    ],
  };
}
