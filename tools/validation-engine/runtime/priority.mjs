const HASH64 = /^[a-f0-9]{64}$/;

// Pure ordering only: no waits, telemetry sampling, new jobs, access changes,
// process creation or source edits. Caller supplies reviewed setup/cost data.
export function validatePriority(plan) {
  plan.priorityPolicy ??= {
    cheapSharedCheckMs: 1000,
    firstSetupClass: 'heavy',
  };
  const policy = plan.priorityPolicy;
  if (
    !Number.isFinite(policy.cheapSharedCheckMs) ||
    policy.cheapSharedCheckMs < 0 ||
    !['heavy', 'light'].includes(policy.firstSetupClass)
  )
    throw new Error('explicit bounded priority policy required');
  for (const unit of plan.units) {
    const cost = unit.cost;
    if (cost === undefined) continue;
    if (
      !cost ||
      !['actual', 'estimate'].includes(cost.origin) ||
      !Number.isFinite(cost.wallMs) ||
      cost.wallMs < 0 ||
      !['heavy', 'light', 'unknown'].includes(cost.setupClass)
    )
      throw new Error('invalid explicit unit cost/setup evidence');
    if (cost.origin === 'actual' && !HASH64.test(cost.evidenceSha256))
      throw new Error('actual cost needs receipt digest');
    if (
      cost.origin === 'estimate' &&
      (typeof cost.reason !== 'string' || !cost.reason.trim())
    )
      throw new Error('cost estimate needs explicit reason');
  }
}

export function effectiveDependencies(plan) {
  const lanes = new Map(plan.lanes.map((lane) => [lane.id, lane]));
  const laneUnits = new Map(
    plan.lanes.map((lane) => [
      lane.id,
      plan.units.filter((unit) => unit.lane === lane.id).map((unit) => unit.id),
    ])
  );
  const laneClosure = (id, seen = new Set()) => {
    if (seen.has(id)) return seen;
    seen.add(id);
    [...lanes.get(id).dependsOn, ...(lanes.get(id).after ?? [])].forEach(
      (parent) => laneClosure(parent, seen)
    );
    return seen;
  };
  return new Map(
    plan.units.map((unit) => [
      unit.id,
      [
        ...new Set([
          ...unit.dependsOn,
          ...(unit.after ?? []),
          ...[
            ...lanes.get(unit.lane).dependsOn,
            ...(lanes.get(unit.lane).after ?? []),
          ].flatMap((id) =>
            [...laneClosure(id)].flatMap((laneId) => laneUnits.get(laneId))
          ),
        ]),
      ],
    ])
  );
}

export function schedulingMetadata(plan) {
  const dependencies = effectiveDependencies(plan);
  const children = new Map(plan.units.map((unit) => [unit.id, []]));
  for (const [id, parents] of dependencies)
    parents.forEach((parent) => children.get(parent).push(id));
  const downstream = (id, seen = new Set()) => {
    for (const child of children.get(id))
      if (!seen.has(child)) {
        seen.add(child);
        downstream(child, seen);
      }
    return seen;
  };
  const kinds = new Map(plan.lanes.map((lane) => [lane.id, lane.kind]));
  return new Map(
    plan.units.map((unit, index) => {
      const impact = downstream(unit.id).size;
      const sharedCheap =
        ['check', 'prerequisite'].includes(kinds.get(unit.lane)) &&
        impact > 0 &&
        unit.cost !== undefined &&
        unit.cost.wallMs <= plan.priorityPolicy.cheapSharedCheckMs;
      return [
        unit.id,
        {
          originalIndex: index,
          downstreamUnitImpact: impact,
          band: sharedCheap ? 0 : 1,
          estimatedOrMeasuredWallMs: unit.cost?.wallMs ?? null,
          costOrigin: unit.cost?.origin ?? 'unknown',
          setupClass: unit.cost?.setupClass ?? 'unknown',
          evidenceSha256: unit.cost?.evidenceSha256 ?? null,
          rationale: sharedCheap
            ? 'cheap shared declared DAG gate'
            : impact === 0
              ? 'terminal ready work; long known cost early'
              : 'other ready declared DAG work',
        },
      ];
    })
  );
}

// Within each priority band alternate reviewed heavy/light categories, taking
// the longest known cost first from each category. Unknown classifications
// remain deterministic and are not assigned invented costs/classes. Every
// ready unit appears once; admissions still use original conflict FIFO.
export function orderReadyUnits(
  plan,
  ready,
  metadata = schedulingMetadata(plan),
  lastSetupClass = null
) {
  const compare = (a, b) => {
    const x = metadata.get(a.id),
      y = metadata.get(b.id);
    if (x.band !== y.band) return x.band - y.band;
    if (x.band === 0 && x.downstreamUnitImpact !== y.downstreamUnitImpact)
      return y.downstreamUnitImpact - x.downstreamUnitImpact;
    const xCost = x.estimatedOrMeasuredWallMs,
      yCost = y.estimatedOrMeasuredWallMs;
    if (xCost !== null && yCost !== null && xCost !== yCost)
      return yCost - xCost;
    if ((xCost === null) !== (yCost === null)) return xCost === null ? 1 : -1;
    return x.originalIndex - y.originalIndex;
  };
  const ordered = [];
  let next =
    lastSetupClass === 'heavy'
      ? 'light'
      : lastSetupClass === 'light'
        ? 'heavy'
        : plan.priorityPolicy.firstSetupClass;
  for (const band of [0, 1]) {
    const group = ready
      .filter((unit) => metadata.get(unit.id).band === band)
      .sort(compare);
    const queues = Object.fromEntries(
      ['heavy', 'light', 'unknown'].map((kind) => [
        kind,
        group.filter((unit) => metadata.get(unit.id).setupClass === kind),
      ])
    );
    while (queues.heavy.length || queues.light.length) {
      const chosen = queues[next].length
        ? next
        : next === 'heavy'
          ? 'light'
          : 'heavy';
      ordered.push(queues[chosen].shift());
      next = chosen === 'heavy' ? 'light' : 'heavy';
    }
    ordered.push(...queues.unknown);
  }
  return ordered;
}
