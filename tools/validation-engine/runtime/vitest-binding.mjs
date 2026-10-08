// Native Vitest binding for the existing engine. This is configuration, not a
// second runner: the application's normal test/test:ci commands stay unchanged.
export const QUIET_TEST_FILES = Object.freeze([
  'server/lib/startupMigrations.test.ts',
  'server/routes/calendar.openapi.test.ts',
  'server/routes/search.test.ts',
  'server/test/runner.test.ts',
  'server/utils/gracefulShutdown.process.test.ts',
]);

export function partitionVitestFiles(files) {
  if (!Array.isArray(files) || new Set(files).size !== files.length)
    throw new Error('Unique, explicit Vitest file ownership required');
  const quiet = new Set(QUIET_TEST_FILES);
  return {
    regular: files.filter((file) => !quiet.has(file)),
    quiet: files.filter((file) => quiet.has(file)),
  };
}

export function engineVitestProjects({
  include,
  exclude = [],
  workers,
  files,
}) {
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 256)
    throw new Error('Engine Vitest workers must be an integer1..256');
  const selection = files ? partitionVitestFiles(files) : null;
  const projects = [
    {
      extends: true,
      test: {
        name: 'engine-regular',
        include: selection?.regular ?? include,
        exclude: [...exclude, ...QUIET_TEST_FILES],
        isolate: true,
        pool: 'forks',
        fileParallelism: true,
        maxWorkers: workers,
        minWorkers: 1,
        // Positive orders avoid Vitest's special handling of group0/one worker.
        sequence: { concurrent: false, setupFiles: 'list', groupOrder: 1 },
      },
    },
    {
      extends: true,
      test: {
        name: 'engine-quiet',
        include: selection?.quiet ?? [...QUIET_TEST_FILES],
        exclude: [...exclude],
        isolate: true,
        pool: 'forks',
        fileParallelism: false,
        maxWorkers: 1,
        minWorkers: 1,
        sequence: { concurrent: false, setupFiles: 'list', groupOrder: 2 },
      },
    },
  ];
  // Empty subset projects are omitted explicitly, never broadened to defaults.
  return selection
    ? projects.filter((project) => project.test.include.length > 0)
    : projects;
}

export function isEngineVitestProjects(projects) {
  if (!Array.isArray(projects) || projects.length !== 2) return false;
  try {
    return (
      JSON.stringify(projects) ===
      JSON.stringify(
        engineVitestProjects({
          include: projects[0].test.include,
          exclude: projects[1].test.exclude,
          workers: projects[0].test.maxWorkers,
        })
      )
    );
  } catch {
    return false;
  }
}
