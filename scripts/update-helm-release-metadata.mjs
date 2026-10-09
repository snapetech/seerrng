import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function replaceExactlyOnce(content, expression, replacement, description) {
  const flags = expression.flags.includes('g')
    ? expression.flags
    : `${expression.flags}g`;
  const matches = [...content.matchAll(new RegExp(expression.source, flags))];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${description}, found ${matches.length}.`
    );
  }

  return content.replace(expression, replacement);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function incrementChartVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) {
    throw new Error(`Invalid chart version: ${version}`);
  }

  const patch = BigInt(match[3]) + 1n;
  return `${match[1]}.${match[2]}.${patch}`;
}

export async function updateHelmReleaseMetadata(
  tagVersion,
  chartDirectory = path.join(repositoryRoot, 'charts', 'seerr-chart')
) {
  if (!/^v[0-9][0-9A-Za-z._+-]{0,127}$/u.test(tagVersion)) {
    throw new Error(`Invalid application tag version: ${tagVersion}`);
  }

  const chartFile = path.join(chartDirectory, 'Chart.yaml');
  const readmeFile = path.join(chartDirectory, 'README.md');
  const [chart, readme] = await Promise.all([
    fs.readFile(chartFile, 'utf8'),
    fs.readFile(readmeFile, 'utf8'),
  ]);
  const chartVersionMatch = /^version: ([^\r\n]+)$/mu.exec(chart);
  if (!chartVersionMatch) {
    throw new Error('Expected exactly one chart version in Chart.yaml.');
  }

  const chartVersion = chartVersionMatch[1];
  const nextChartVersion = incrementChartVersion(chartVersion);
  const nextChart = replaceExactlyOnce(
    chart,
    /^version: [^\r\n]+$/mu,
    `version: ${nextChartVersion}`,
    'chart version in Chart.yaml'
  );
  const updatedChart = replaceExactlyOnce(
    nextChart,
    /^appVersion: '[^'\r\n]+'$/mu,
    `appVersion: '${tagVersion}'`,
    'application version in Chart.yaml'
  );

  let updatedReadme = replaceExactlyOnce(
    readme,
    new RegExp(
      `Version-${escapeRegExp(chartVersion)}-informational\\?style=flat-square`,
      'gu'
    ),
    `Version-${nextChartVersion}-informational?style=flat-square`,
    'chart version badge in README.md'
  );
  updatedReadme = replaceExactlyOnce(
    updatedReadme,
    new RegExp(`Version: ${escapeRegExp(chartVersion)}(?=\\])`, 'gu'),
    `Version: ${nextChartVersion}`,
    'chart version label in README.md'
  );
  updatedReadme = replaceExactlyOnce(
    updatedReadme,
    /AppVersion-v[^?]+\?style=flat-square/gu,
    `AppVersion-${tagVersion}-informational?style=flat-square`,
    'application version badge in README.md'
  );
  updatedReadme = replaceExactlyOnce(
    updatedReadme,
    /AppVersion: v[^\]]+/gu,
    `AppVersion: ${tagVersion}`,
    'application version label in README.md'
  );

  await Promise.all([
    fs.writeFile(chartFile, updatedChart),
    fs.writeFile(readmeFile, updatedReadme),
  ]);

  return { chartVersion: nextChartVersion, appVersion: tagVersion };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await updateHelmReleaseMetadata(process.argv[2]);
    process.stdout.write(
      `Updated Helm chart to ${result.chartVersion} for ${result.appVersion}.\n`
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
