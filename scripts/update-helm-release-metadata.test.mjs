import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { updateHelmReleaseMetadata } from './update-helm-release-metadata.mjs';

async function createChartFixture(
  t,
  {
    appBadge = 'AppVersion-v3.57.0?style=flat-square',
    chartVersion = '1.0.106',
  } = {}
) {
  const chartDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'seerrng-helm-metadata-')
  );
  t.after(() => fs.rm(chartDirectory, { recursive: true, force: true }));

  await fs.writeFile(
    path.join(chartDirectory, 'Chart.yaml'),
    `apiVersion: v2\nname: seerr-chart\nversion: ${chartVersion}\nappVersion: 'v3.57.0'\n`
  );
  await fs.writeFile(
    path.join(chartDirectory, 'README.md'),
    [
      '# seerr-chart',
      '',
      `![Version: ${chartVersion}](https://img.shields.io/badge/Version-${chartVersion}-informational?style=flat-square) ![AppVersion: v3.57.0](https://img.shields.io/badge/${appBadge})`,
      '',
    ].join('\n')
  );

  return chartDirectory;
}

test('increments the chart version and preserves the informational app badge', async (t) => {
  const chartDirectory = await createChartFixture(t);

  const result = await updateHelmReleaseMetadata('v3.58.0', chartDirectory);
  const chart = await fs.readFile(
    path.join(chartDirectory, 'Chart.yaml'),
    'utf8'
  );
  const readme = await fs.readFile(
    path.join(chartDirectory, 'README.md'),
    'utf8'
  );

  assert.deepEqual(result, { chartVersion: '1.0.107', appVersion: 'v3.58.0' });
  assert.match(chart, /^version: 1\.0\.107$/mu);
  assert.match(chart, /^appVersion: 'v3\.58\.0'$/mu);
  assert.match(readme, /Version-1\.0\.107-informational\?style=flat-square/u);
  assert.match(
    readme,
    /AppVersion-v3\.58\.0-informational\?style=flat-square/u
  );
  assert.match(readme, /AppVersion: v3\.58\.0/u);
});

test('keeps an already-correct app version badge to one informational suffix', async (t) => {
  const chartDirectory = await createChartFixture(t, {
    appBadge: 'AppVersion-v3.57.0-informational?style=flat-square',
  });

  await updateHelmReleaseMetadata('v3.58.0', chartDirectory);

  const readme = await fs.readFile(
    path.join(chartDirectory, 'README.md'),
    'utf8'
  );
  assert.match(
    readme,
    /AppVersion-v3\.58\.0-informational\?style=flat-square/u
  );
  assert.doesNotMatch(readme, /informational-informational/u);
});

test('refuses incomplete documentation without changing either file', async (t) => {
  const chartDirectory = await createChartFixture(t, {
    appBadge: 'AppVersion-v3.57.0?style=rounded',
  });
  const chartFile = path.join(chartDirectory, 'Chart.yaml');
  const readmeFile = path.join(chartDirectory, 'README.md');
  const [originalChart, originalReadme] = await Promise.all([
    fs.readFile(chartFile, 'utf8'),
    fs.readFile(readmeFile, 'utf8'),
  ]);

  await assert.rejects(
    updateHelmReleaseMetadata('v3.58.0', chartDirectory),
    /Expected exactly one application version badge/u
  );

  assert.equal(await fs.readFile(chartFile, 'utf8'), originalChart);
  assert.equal(await fs.readFile(readmeFile, 'utf8'), originalReadme);
});

test('rejects malformed application tags without changing chart metadata', async (t) => {
  const chartDirectory = await createChartFixture(t);
  const chartFile = path.join(chartDirectory, 'Chart.yaml');
  const originalChart = await fs.readFile(chartFile, 'utf8');

  await assert.rejects(
    updateHelmReleaseMetadata('3.58.0', chartDirectory),
    /Invalid application tag version/u
  );

  assert.equal(await fs.readFile(chartFile, 'utf8'), originalChart);
});
