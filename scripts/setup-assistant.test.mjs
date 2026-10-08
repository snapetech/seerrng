import { load } from 'js-yaml';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  apps,
  buildManualConnections,
  connectionAppIds,
  discoverNetworkApps,
  parseComposeStatus,
  probeKnownAppPorts,
  profiles,
  renderCompose,
  renderDiscoveredConnections,
  renderGuide,
  renderManualConnections,
  renderProbedConnections,
} from './setup-assistant.mjs';

test('manual connection suggestions cover native installs without Docker', () => {
  const connections = buildManualConnections(
    'media.example.net',
    ['radarr', 'sonarr', 'bookshelf', 'questarrng'],
    { sonarr: 9999 }
  );
  assert.deepEqual(
    connections.map(({ id, hostname, port }) => ({ id, hostname, port })),
    [
      { id: 'radarr', hostname: 'media.example.net', port: 7878 },
      { id: 'sonarr', hostname: 'media.example.net', port: 9999 },
      { id: 'bookshelf', hostname: 'media.example.net', port: 8787 },
      { id: 'questarrng', hostname: 'media.example.net', port: 5000 },
    ]
  );
  assert.ok(connectionAppIds.includes('radarr'));
  assert.ok(!connectionAppIds.includes('qbittorrent'));
  assert.throws(
    () => buildManualConnections('http://media.example.net', ['radarr']),
    /DNS name or IPv4 address/
  );
  assert.throws(
    () => buildManualConnections('localhost', ['radarr'], { radarr: 65536 }),
    /between 1 and 65535/
  );
  assert.throws(
    () => buildManualConnections('localhost', ['qbittorrent']),
    /cannot be imported/
  );

  const guide = renderManualConnections('media.example.net', connections);
  assert.match(guide, /native Windows, macOS, or Linux installs/);
  assert.match(
    guide,
    /Do not use `localhost` when SeerrNG runs in a container/
  );
  assert.match(guide, /separate Book and Audiobook service entries/);
  assert.match(guide, /Software Acquisition/);
});

test('host probes stay on one host, use bounded known ports, and omit ambiguous app matches', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const result = await probeKnownAppPorts(
    'media.example.net',
    ['radarr', 'sonarr', 'bookshelf', 'backissue'],
    async (hostname, port, timeout) => {
      calls.push({ hostname, port, timeout });
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return port === 7878 || port === 8787;
    }
  );

  assert.equal(calls.length, 3);
  assert.ok(maxActive <= 4);
  assert.ok(calls.every((call) => call.hostname === 'media.example.net'));
  assert.ok(calls.every((call) => call.timeout === 900));
  assert.deepEqual(result.openPorts, [
    { port: 7878, candidates: ['radarr'], reachable: true },
    {
      port: 8787,
      candidates: ['bookshelf', 'backissue'],
      reachable: true,
    },
  ]);
  assert.deepEqual(
    result.connections.map(({ id }) => id),
    ['radarr']
  );

  const guide = renderProbedConnections(
    'media.example.net',
    result.openPorts,
    result.connections
  );
  assert.match(guide, /does not prove which app is listening/);
  assert.match(guide, /8787.*ambiguous/);
  assert.match(
    guide,
    /No HTTP requests, API keys, or service settings were read/
  );
});

test('host probes reject unsafe hosts and support an explicitly selected ambiguous app', async () => {
  let calls = 0;
  const connect = async () => {
    calls += 1;
    return true;
  };
  await assert.rejects(
    probeKnownAppPorts('http://localhost', ['radarr'], connect),
    /DNS name or IPv4 address/
  );
  assert.equal(calls, 0);

  const result = await probeKnownAppPorts('localhost', ['backissue'], connect);
  assert.equal(result.openPorts[0].port, 8787);
  assert.equal(result.openPorts[0].candidates.length, 1);
  assert.equal(result.connections[0].id, 'backissue');
});

test('every starter profile contains SeerrNG and known app definitions', () => {
  for (const [name, profile] of Object.entries(profiles)) {
    assert.ok(profile.apps.includes('seerrng'), `${name} includes SeerrNG`);
    for (const app of profile.apps)
      assert.ok(apps[app], `${name} app ${app} exists`);
  }
});

test('the complete app catalog renders valid Compose with distinct format storage', () => {
  const compose = renderCompose(Object.keys(apps));
  const document = load(compose);

  assert.deepEqual(Object.keys(document.services), Object.keys(apps));
  assert.equal(
    document.services.bookshelf.ports[0],
    '127.0.0.1:${BOOKSHELF_HOST_PORT:-8787}:8787'
  );
  assert.equal(
    document.services.backissue.ports[0],
    '127.0.0.1:${BACKISSUE_HOST_PORT:-8788}:8787'
  );
  assert.deepEqual(document.services.backissue.environment, {
    PUID: '${PUID:-1000}',
    PGID: '${PGID:-1000}',
    TZ: '${TZ:-Etc/UTC}',
    UMASK: '022',
  });
  assert.equal(document.services.chaptarrng.volumes[1], 'ebook-data:/ebooks');
  assert.equal(
    document.services.chaptarrng.volumes[2],
    'audiobook-data:/audiobooks'
  );
  assert.equal(document.services.romarrng.environment.LIBRARY_PATH, '/roms');
  assert.equal(document.services.questarrng.environment.PORT, 5000);
});

test('profiles and optional app additions cover each supported media category', () => {
  assert.ok(profiles['movies-tv'].apps.includes('radarr'));
  assert.ok(profiles['movies-tv'].apps.includes('sonarr'));
  assert.ok(profiles.music.apps.includes('lidarr'));
  assert.ok(profiles.books.apps.includes('bookshelf'));
  assert.ok(profiles['books-chaptarrng'].apps.includes('chaptarrng'));
  assert.ok(profiles.comics.apps.includes('mylar3'));
  assert.ok(profiles.magazines.apps.includes('lazylibrarian'));
  assert.ok(profiles.software.apps.includes('questarrng'));
  assert.ok(profiles.software.apps.includes('romarrng'));
  assert.ok(apps.kapowarr && apps.backissue);
});

test('generated Compose uses persistent named volumes and configurable local web ports', () => {
  const compose = renderCompose(profiles['movies-tv'].apps);
  const document = load(compose);
  assert.deepEqual(Object.keys(document.services), profiles['movies-tv'].apps);
  assert.match(compose, /127\.0\.0\.1:\$\{SEERRNG_HOST_PORT:-5055\}:5055/);
  assert.match(compose, /127\.0\.0\.1:\$\{RADARR_HOST_PORT:-7878\}:7878/);
  assert.match(compose, /radarr-config:\/config/);
  assert.match(compose, /media-data:\/data/);
  assert.match(compose, /downloads:\/downloads/);
  assert.match(compose, /media-data: \{\}/);
  assert.doesNotMatch(compose, /container_name:/);
  assert.match(compose, /WEBUI_PORT: "8080"/);
  assert.match(compose, /TORRENTING_PORT: "6881"/);
  assert.match(compose, /QBITTORRENT_PEER_PORT:-6881/);
});

test('setup guide uses Compose DNS names and keeps API keys out of generated content', () => {
  const guide = renderGuide(profiles.books.apps, profiles.books.title);
  assert.match(guide, /Books \(BookshelfNG\): bookshelf:8787/);
  assert.match(guide, /use the service address below as its hostname/);
  assert.match(guide, /API key from that app’s settings/);
  assert.match(guide, /qBittorrent as the download client/);
  assert.match(guide, /peer traffic on TCP and UDP port 6881/);
  assert.match(guide, /temporary `admin` password in its container log/);
  assert.match(guide, /BookshelfNG\): bookshelf:8787 \(Book format\)/);
  assert.match(guide, /BookshelfNG\): bookshelf:8787 \(Audiobook format\)/);
  assert.match(guide, /content files in `media-data` named volumes/);
  assert.match(guide, /BookshelfNG `\/data`/);
  assert.doesNotMatch(guide, /api[_ -]?key\s*[:=]\s*\S+/i);
});

test('generated guide only describes storage and ports present in that selection', () => {
  const guide = renderGuide(['seerrng'], 'SeerrNG only');
  assert.doesNotMatch(guide, /qBittorrent/);
  assert.doesNotMatch(guide, /media-data|`downloads`|qBittorrent/);
  assert.match(guide, /SEERRNG_HOST_PORT/);
});

test('app-only stacks join an explicitly named external network', () => {
  const selectedApps = profiles['movies-tv'].apps.filter(
    (app) => app !== 'seerrng'
  );
  assert.throws(() => renderCompose(selectedApps), /requires --network/);

  const compose = load(renderCompose(selectedApps, 'existing-seerr-network'));
  assert.equal(compose.services.seerrng, undefined);
  assert.deepEqual(compose.services.radarr.networks, ['seerrng-shared']);
  assert.equal(
    compose.networks['seerrng-shared'].name,
    'existing-seerr-network'
  );
  const guide = renderGuide(
    selectedApps,
    profiles['movies-tv'].title,
    'existing-seerr-network'
  );
  assert.match(guide, /docker network connect existing-seerr-network/);
  assert.match(guide, /Open your existing SeerrNG instance/);
  assert.match(guide, /use each service address below as its hostname/);
});

test('unknown app definitions fail rather than generating incomplete Compose', () => {
  assert.throws(() => renderCompose(['missing-app']), /Unknown app/);
  assert.throws(
    () => renderCompose(['radarr'], 'bad network name'),
    /Invalid Docker network name/
  );
});

test('Compose detection accepts JSON arrays and Compose JSON-lines output', () => {
  assert.deepEqual(
    parseComposeStatus('[{"Service":"radarr","State":"running"}]'),
    [{ Service: 'radarr', State: 'running' }]
  );
  assert.deepEqual(
    parseComposeStatus(
      '{"Service":"radarr","State":"running"}\n{"Service":"sonarr","State":"exited"}'
    ),
    [
      { Service: 'radarr', State: 'running' },
      { Service: 'sonarr', State: 'exited' },
    ]
  );
});

test('network discovery inspects only the named network and suggests app DNS ports', () => {
  const calls = [];
  const docker = (args) => {
    calls.push(args);
    if (args[0] === 'network') {
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            Id: 'network-id',
            Name: 'media-net',
            Containers: { radarrId: {}, bookshelfId: {}, unknownId: {} },
          },
        ]),
      };
    }
    return {
      status: 0,
      stdout: JSON.stringify([
        {
          Id: 'radarrId',
          Name: '/media-radarr-1',
          Config: {
            Image: 'lscr.io/linuxserver/radarr:latest',
            Labels: { 'com.docker.compose.service': 'radarr' },
            Env: ['RADARR_API_KEY=must-not-appear'],
          },
          State: { Status: 'running' },
          NetworkSettings: {
            Networks: {
              'media-net': {
                NetworkID: 'network-id',
                Aliases: ['media-radarr-1', 'radarr'],
              },
            },
          },
        },
        {
          Id: 'bookshelfId',
          Name: '/bookshelf',
          Config: {
            Image: 'ghcr.io/snapetech/bookshelfng:hardcover',
            Labels: {},
          },
          State: { Status: 'running' },
          NetworkSettings: {
            Networks: {
              'media-net': {
                NetworkID: 'network-id',
                Aliases: ['bookshelf'],
              },
            },
          },
        },
        {
          Id: 'unknownId',
          Name: '/other',
          Config: {
            Image: 'example.invalid/unknown:latest',
            Env: ['SECRET=private'],
          },
          NetworkSettings: { Networks: {} },
        },
      ]),
    };
  };

  const connections = discoverNetworkApps('media-net', docker);
  assert.deepEqual(calls, [
    ['network', 'inspect', 'media-net'],
    ['inspect', '--type', 'container', 'radarrId', 'bookshelfId', 'unknownId'],
  ]);
  assert.deepEqual(connections, [
    {
      id: 'radarr',
      title: 'Radarr',
      hostname: 'radarr',
      port: '7878',
      state: 'running',
    },
    {
      id: 'bookshelf',
      title: 'BookshelfNG',
      hostname: 'bookshelf',
      port: '8787',
      state: 'running',
    },
  ]);

  const guide = renderDiscoveredConnections('media-net', connections);
  assert.match(guide, /hostname `radarr`, port `7878`/);
  assert.match(guide, /separate Book and Audiobook service entries/);
  assert.doesNotMatch(
    guide,
    /must-not-appear|SECRET=private|api[_ -]?key\s*[:=]/i
  );
});

test('network discovery rejects invalid names and caps large network inspection', () => {
  let callCount = 0;
  const docker = () => {
    callCount += 1;
    return {
      status: 0,
      stdout: JSON.stringify([
        {
          Id: 'large-network',
          Name: 'media-net',
          Containers: Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`container-${index}`, {}])
          ),
        },
      ]),
    };
  };

  assert.throws(
    () => discoverNetworkApps('invalid network', docker),
    /valid Docker network/
  );
  assert.equal(callCount, 0);
  assert.throws(() => discoverNetworkApps('media-net', docker), /more than 64/);
  assert.equal(callCount, 1);
});

test('interactive setup writes the selected profile and refuses to overwrite it', async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'seerrng-setup-assistant-')
  );
  const outputDirectory = path.join(temporaryDirectory, 'stack');
  const scriptPath = fileURLToPath(
    new URL('./setup-assistant.mjs', import.meta.url)
  );
  const run = (extraArguments = []) =>
    spawnSync(
      process.execPath,
      [scriptPath, '--profile', 'movies-tv', '--output', ...extraArguments],
      { encoding: 'utf8' }
    );

  try {
    const firstRun = run([outputDirectory, '--yes']);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const compose = await readFile(
      path.join(outputDirectory, 'compose.yaml'),
      'utf8'
    );
    const guide = await readFile(
      path.join(outputDirectory, 'SETUP.md'),
      'utf8'
    );
    assert.match(compose, /sonarr:/);
    assert.match(guide, /Radarr: radarr:7878/);

    const secondRun = run([outputDirectory, '--yes']);
    assert.equal(secondRun.status, 1);
    assert.match(secondRun.stderr, /output files already exist/i);

    const appOnlyDirectory = path.join(temporaryDirectory, 'apps-only');
    const appOnlyRun = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--profile',
        'movies-tv',
        '--apps',
        '-seerrng',
        '--network',
        'existing-seerr-network',
        '--output',
        appOnlyDirectory,
        '--yes',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(appOnlyRun.status, 0, appOnlyRun.stderr);
    const appOnlyCompose = await readFile(
      path.join(appOnlyDirectory, 'compose.yaml'),
      'utf8'
    );
    assert.doesNotMatch(appOnlyCompose, /\n  seerrng:/);
    assert.match(appOnlyCompose, /name: "existing-seerr-network"/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('non-Docker connection report works unattended and refuses to overwrite files', async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'seerrng-connections-assistant-')
  );
  const outputDirectory = path.join(temporaryDirectory, 'connections');
  const scriptPath = fileURLToPath(
    new URL('./setup-assistant.mjs', import.meta.url)
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--connections',
        '--apps',
        'radarr,sonarr',
        '--host',
        'media.example.net',
        '--output',
        outputDirectory,
        '--yes',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(
      await readFile(
        path.join(outputDirectory, 'seerrng-connections.json'),
        'utf8'
      )
    );
    assert.deepEqual(
      report.connections.map(({ id, hostname, port }) => ({
        id,
        hostname,
        port,
      })),
      [
        { id: 'radarr', hostname: 'media.example.net', port: 7878 },
        { id: 'sonarr', hostname: 'media.example.net', port: 8989 },
      ]
    );
    const guide = await readFile(
      path.join(outputDirectory, 'CONNECTIONS.md'),
      'utf8'
    );
    assert.match(guide, /API keys are included/);
    assert.match(guide, /Do not use `localhost`/);

    const secondRun = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--connections',
        '--apps',
        'radarr',
        '--host',
        'media.example.net',
        '--output',
        outputDirectory,
        '--yes',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(secondRun.status, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
