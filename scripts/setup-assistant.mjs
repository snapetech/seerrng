#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { stderr, stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

export const apps = {
  seerrng: {
    title: 'SeerrNG',
    image: 'ghcr.io/snapetech/seerrng:latest',
    port: '5055',
    volumes: ['seerrng-config:/app/config'],
    integrations: [],
  },
  radarr: {
    title: 'Radarr',
    image: 'lscr.io/linuxserver/radarr:latest',
    port: '7878',
    volumes: [
      'radarr-config:/config',
      'media-data:/data',
      'downloads:/downloads',
    ],
    integrations: ['Radarr: radarr:7878'],
  },
  sonarr: {
    title: 'Sonarr',
    image: 'lscr.io/linuxserver/sonarr:latest',
    port: '8989',
    volumes: [
      'sonarr-config:/config',
      'media-data:/data',
      'downloads:/downloads',
    ],
    integrations: ['Sonarr: sonarr:8989'],
  },
  lidarr: {
    title: 'Lidarr',
    image: 'lscr.io/linuxserver/lidarr:latest',
    port: '8686',
    volumes: [
      'lidarr-config:/config',
      'media-data:/data',
      'downloads:/downloads',
    ],
    integrations: ['Lidarr: lidarr:8686'],
  },
  bookshelf: {
    title: 'BookshelfNG',
    image: 'ghcr.io/snapetech/bookshelfng:hardcover',
    port: '8787',
    volumes: [
      'bookshelf-config:/config',
      'media-data:/data',
      'downloads:/downloads',
    ],
    integrations: [
      'Books (BookshelfNG): bookshelf:8787 (Book format)',
      'Audiobooks (BookshelfNG): bookshelf:8787 (Audiobook format)',
    ],
  },
  chaptarrng: {
    title: 'ChaptarrNG',
    image: 'ghcr.io/snapetech/chaptarrng:0.9.937',
    port: '8789',
    volumes: [
      'chaptarrng-config:/config',
      'ebook-data:/ebooks',
      'audiobook-data:/audiobooks',
      'downloads:/downloads',
    ],
    integrations: [
      'Books (ChaptarrNG): chaptarrng:8789 (Book format)',
      'Audiobooks (ChaptarrNG): chaptarrng:8789 (Audiobook format)',
    ],
  },
  prowlarr: {
    title: 'Prowlarr',
    image: 'lscr.io/linuxserver/prowlarr:latest',
    port: '9696',
    volumes: ['prowlarr-config:/config'],
    integrations: ['Prowlarr: prowlarr:9696'],
  },
  qbittorrent: {
    title: 'qBittorrent',
    image: 'lscr.io/linuxserver/qbittorrent:latest',
    port: '8080',
    volumes: ['qbittorrent-config:/config', 'downloads:/downloads'],
    integrations: [],
  },
  lazylibrarian: {
    title: 'LazyLibrarian',
    image: 'lscr.io/linuxserver/lazylibrarian:latest',
    port: '5299',
    volumes: [
      'lazylibrarian-config:/config',
      'media-data:/books',
      'downloads:/downloads',
    ],
    integrations: ['Magazines (LazyLibrarian): lazylibrarian:5299'],
  },
  mylar3: {
    title: 'Mylar3',
    image: 'lscr.io/linuxserver/mylar3:latest',
    port: '8090',
    volumes: [
      'mylar3-config:/config',
      'media-data:/comics',
      'downloads:/downloads',
    ],
    integrations: ['Comics (Mylar3): mylar3:8090'],
  },
  kapowarr: {
    title: 'Kapowarr',
    image: 'mrcas/kapowarr:latest',
    port: '5656',
    volumes: [
      'kapowarr-config:/app/db',
      'media-data:/comics',
      'downloads:/app/temp_downloads',
    ],
    integrations: ['Comics (Kapowarr): kapowarr:5656'],
  },
  backissue: {
    title: 'BackIssue',
    image: 'ghcr.io/backissueapp/backissue:latest',
    port: '8787',
    hostPort: '8788',
    architectures: ['amd64'],
    volumes: [
      'backissue-config:/data',
      'media-data:/comics',
      'downloads:/downloads',
    ],
    integrations: ['Comics (BackIssue): backissue:8787'],
  },
  romarrng: {
    title: 'ROMarrNG',
    image: 'ghcr.io/snapetech/romarrng:latest',
    port: '6868',
    volumes: [
      'romarrng-config:/config',
      'media-data:/roms',
      'downloads:/downloads',
    ],
    integrations: ['Emulation ROMs (ROMarrNG): romarrng:6868'],
  },
  questarrng: {
    title: 'QuestarrNG',
    image: 'ghcr.io/snapetech/questarrng:latest',
    port: '5000',
    volumes: [
      'questarrng-config:/app/data',
      'media-data:/data',
      'downloads:/downloads',
    ],
    integrations: ['PC games (QuestarrNG): questarrng:5000'],
  },
};

export const connectionAppIds = Object.keys(apps).filter(
  (id) => !['seerrng', 'qbittorrent'].includes(id)
);

const isSafeHostname = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/.test(value);

export const buildManualConnections = (
  hostname,
  appIds,
  portOverrides = {}
) => {
  if (!isSafeHostname(hostname)) {
    throw new Error(
      'Host must be a DNS name or IPv4 address without a URL scheme or path.'
    );
  }
  if (!Array.isArray(appIds) || appIds.length === 0) {
    throw new Error('Select at least one supported app to connect.');
  }

  const uniqueIds = [...new Set(appIds)];
  for (const id of uniqueIds) {
    if (!connectionAppIds.includes(id)) {
      throw new Error(`App "${id}" cannot be imported as a connection.`);
    }
  }

  return uniqueIds.map((id) => {
    const rawPort = portOverrides[id] ?? apps[id].port;
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `Port for ${apps[id].title} must be between 1 and 65535.`
      );
    }
    return {
      id,
      title: apps[id].title,
      hostname,
      port,
      state: 'manual',
    };
  });
};

export const renderManualConnections = (hostname, connections) => {
  const lines = [
    '# SeerrNG connection suggestions',
    '',
    `These addresses were entered manually for ${hostname}. They work with native Windows, macOS, or Linux installs, package installs, and services hosted on another reachable machine.`,
    '',
    'Import `seerrng-connections.json` in SeerrNG under **Settings → Services**. Enter each app’s API key in SeerrNG and use **Test** to verify the API and load its options before saving. No API keys are included in this report.',
    '',
    'The port values start with each app’s common default. Change them if the app uses a custom port. Do not use `localhost` when SeerrNG runs in a container and the app runs on the host: `localhost` would point back into the SeerrNG container. Use a hostname or IP address reachable from SeerrNG instead.',
    '',
  ];
  if (connections.length === 0) {
    lines.push('No apps were selected.');
  } else {
    for (const connection of connections) {
      lines.push(
        `- **${connection.title}** — hostname \`${connection.hostname}\`, port \`${connection.port}\``
      );
      if (connection.id === 'bookshelf' || connection.id === 'chaptarrng') {
        lines.push(
          '  Add separate Book and Audiobook service entries using the same hostname, port, and API key.'
        );
      }
      if (connection.id === 'questarrng' || connection.id === 'romarrng') {
        lines.push(
          '  Configure this provider under **Settings → Services → Software Acquisition**.'
        );
      }
      if (connection.id === 'prowlarr') {
        lines.push('  Configure this provider under **Settings → Prowlarr**.');
      }
    }
  }
  return `${lines.join('\n')}\n`;
};

const probeTcpPort = (hostname, port, timeoutMs = 900) =>
  new Promise((resolve) => {
    const socket = createConnection({ host: hostname, port });
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });

export const probeKnownAppPorts = async (
  hostname,
  requestedAppIds = connectionAppIds,
  connect = probeTcpPort
) => {
  if (!isSafeHostname(hostname)) {
    throw new Error(
      'Host must be a DNS name or IPv4 address without a URL scheme or path.'
    );
  }
  const selectedIds = [...new Set(requestedAppIds)];
  if (selectedIds.length === 0) {
    throw new Error('Select at least one supported app to probe.');
  }
  for (const id of selectedIds) {
    if (!connectionAppIds.includes(id)) {
      throw new Error(`App "${id}" cannot be probed as a SeerrNG connection.`);
    }
  }

  const candidatesByPort = new Map();
  for (const id of selectedIds) {
    const port = Number(apps[id].port);
    candidatesByPort.set(port, [...(candidatesByPort.get(port) ?? []), id]);
  }
  const ports = [...candidatesByPort.keys()];
  const results = Array(ports.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < ports.length) {
      const index = nextIndex++;
      const port = ports[index];
      let reachable = false;
      try {
        reachable = await connect(hostname, port, 900);
      } catch {
        reachable = false;
      }
      results[index] = {
        port,
        candidates: candidatesByPort.get(port),
        reachable: reachable === true,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, ports.length) }, () => worker())
  );

  const openPorts = results.filter((result) => result.reachable);
  const connections = openPorts.flatMap((result) =>
    result.candidates.length === 1
      ? buildManualConnections(hostname, result.candidates).map((connection) =>
          Object.assign(connection, { state: 'reachable' })
        )
      : []
  );
  return { openPorts, connections };
};

export const renderProbedConnections = (hostname, openPorts, connections) => {
  const lines = [
    '# Probed SeerrNG service ports',
    '',
    `The setup assistant attempted TCP connections to common app ports on the explicitly selected host \`${hostname}\`. A reachable port does not prove which app is listening; confirm each suggestion with SeerrNG’s **Test** action. No HTTP requests, API keys, or service settings were read.`,
    '',
  ];
  if (openPorts.length === 0) {
    lines.push('No common service ports accepted a TCP connection.');
  } else {
    for (const result of openPorts) {
      const labels = result.candidates.map((id) => apps[id].title).join(' / ');
      lines.push(
        `- Port \`${result.port}\` is reachable; common default candidate${result.candidates.length > 1 ? 's' : ''}: ${labels}${result.candidates.length === 1 ? ' (added as a suggestion)' : ' (ambiguous; enter the app and port manually)'}.`
      );
    }
  }
  lines.push(
    '',
    'Only ports with one selected app using that default are included in the import file. Open ports can belong to unrelated software, and custom ports are not scanned. Use manual connection mode for custom ports or ambiguous matches.',
    ''
  );
  return `${lines.join('\n')}\n`;
};

export const profiles = {
  'movies-tv': {
    title: 'Movies and TV',
    apps: ['seerrng', 'radarr', 'sonarr', 'prowlarr', 'qbittorrent'],
  },
  books: {
    title: 'Books and audiobooks',
    apps: ['seerrng', 'bookshelf', 'prowlarr', 'qbittorrent'],
  },
  'books-chaptarrng': {
    title: 'Books and audiobooks with ChaptarrNG',
    apps: ['seerrng', 'chaptarrng', 'prowlarr', 'qbittorrent'],
  },
  music: {
    title: 'Music',
    apps: ['seerrng', 'lidarr', 'prowlarr', 'qbittorrent'],
  },
  comics: {
    title: 'Comics with Mylar3',
    apps: ['seerrng', 'mylar3'],
  },
  magazines: {
    title: 'Magazines',
    apps: ['seerrng', 'lazylibrarian', 'prowlarr', 'qbittorrent'],
  },
  software: {
    title: 'PC games and emulation ROMs',
    apps: ['seerrng', 'questarrng', 'romarrng', 'qbittorrent'],
  },
  'media-library': {
    title: 'Starter media library',
    apps: [
      'seerrng',
      'radarr',
      'sonarr',
      'lidarr',
      'bookshelf',
      'prowlarr',
      'qbittorrent',
    ],
  },
  'all-media': {
    title: 'All media formats',
    apps: [
      'seerrng',
      'radarr',
      'sonarr',
      'lidarr',
      'bookshelf',
      'mylar3',
      'lazylibrarian',
      'questarrng',
      'romarrng',
      'prowlarr',
      'qbittorrent',
    ],
  },
};

const quote = (value) => JSON.stringify(value);

export const renderCompose = (selectedApps, sharedNetwork) => {
  for (const id of selectedApps) {
    if (!apps[id]) throw new Error(`Unknown app: ${id}`);
  }
  if (sharedNetwork && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(sharedNetwork)) {
    throw new Error('Invalid Docker network name.');
  }
  if (!selectedApps.includes('seerrng') && !sharedNetwork) {
    throw new Error(
      'An app-only stack requires --network so the existing SeerrNG container can reach its services.'
    );
  }
  const lines = ['services:'];
  for (const id of selectedApps) {
    const app = apps[id];
    lines.push(`  ${id}:`);
    lines.push(`    image: ${quote(app.image)}`);
    lines.push('    restart: unless-stopped');
    if (sharedNetwork) lines.push('    networks:', '      - seerrng-shared');
    lines.push('    ports:');
    const hostPortVariable = `${id.toUpperCase()}_HOST_PORT`;
    lines.push(
      `      - ${quote(`127.0.0.1:\${${hostPortVariable}:-${app.hostPort ?? app.port}}:${app.port}`)}`
    );
    if (id === 'qbittorrent') {
      lines.push('      - "${QBITTORRENT_PEER_PORT:-6881}:6881"');
      lines.push('      - "${QBITTORRENT_PEER_PORT:-6881}:6881/udp"');
    }
    if (
      [
        'radarr',
        'sonarr',
        'lidarr',
        'prowlarr',
        'qbittorrent',
        'chaptarrng',
        'lazylibrarian',
        'mylar3',
        'kapowarr',
        'backissue',
        'romarrng',
        'questarrng',
      ].includes(id)
    ) {
      lines.push('    environment:');
      lines.push('      PUID: ${PUID:-1000}');
      lines.push('      PGID: ${PGID:-1000}');
      lines.push('      TZ: ${TZ:-Etc/UTC}');
    }
    if (id === 'qbittorrent') {
      lines.push('      WEBUI_PORT: "8080"');
      lines.push('      TORRENTING_PORT: "6881"');
    }
    if (id === 'backissue') {
      lines.push('      UMASK: "022"');
    }
    if (id === 'romarrng') lines.push('      LIBRARY_PATH: /roms');
    if (id === 'questarrng') lines.push('      PORT: 5000');
    lines.push('    volumes:');
    for (const volume of app.volumes) lines.push(`      - ${volume}`);
  }
  lines.push('volumes:');
  const volumeNames = new Set(
    selectedApps.flatMap((id) =>
      apps[id].volumes.map((entry) => entry.split(':')[0])
    )
  );
  for (const volume of volumeNames) lines.push(`  ${volume}: {}`);
  if (sharedNetwork) {
    lines.push(
      'networks:',
      '  seerrng-shared:',
      '    external: true',
      `    name: ${quote(sharedNetwork)}`
    );
  }
  return `${lines.join('\n')}\n`;
};

export const renderGuide = (selectedApps, profileTitle, sharedNetwork) => {
  const includesSeerr = selectedApps.includes('seerrng');
  const integrations = selectedApps.flatMap((id) => apps[id].integrations);
  const hasDownloadVolume = selectedApps.some((id) =>
    apps[id].volumes.some((volume) => volume.startsWith('downloads:'))
  );
  const contentVolumeNames = new Set(
    selectedApps.flatMap((id) =>
      apps[id].volumes
        .map((volume) => volume.split(':')[0])
        .filter((name) => name !== 'downloads' && !name.endsWith('-config'))
    )
  );
  const lines = [
    `# ${profileTitle} setup`,
    '',
    sharedNetwork
      ? `This app stack joins the existing Docker network \`${sharedNetwork}\`. Docker named volumes store persistent app configuration.`
      : 'This stack uses Docker named volumes for persistent app configuration. Docker manages these volumes with Docker Desktop on Windows and macOS, and Docker Engine on Linux.',
    '',
    '## Start',
    '',
    ...(sharedNetwork && !includesSeerr
      ? [
          `If the network does not exist yet, create it with \`docker network create ${sharedNetwork}\`. Run \`docker ps\` to find the existing SeerrNG container, then connect it with \`docker network connect ${sharedNetwork} CONTAINER_ID\` (replace \`CONTAINER_ID\` with its name or ID).`,
          'Run `docker compose up -d` in this folder. Open your existing SeerrNG instance.',
        ]
      : [
          ...(sharedNetwork
            ? [
                `If the external network does not exist yet, create it with \`docker network create ${sharedNetwork}\`.`,
              ]
            : []),
          'Run `docker compose up -d` in this folder. Open SeerrNG at http://localhost:5055.',
        ]),
    '',
    '## Connect apps to SeerrNG',
    '',
    `In SeerrNG, open **Settings → Services** for media services. Configure Prowlarr under **Settings → Prowlarr** and QuestarrNG or ROMarrNG under **Settings → Services → Software Acquisition**. Add each app, enter its API key from that app’s settings, and use **Test** before saving. ${sharedNetwork && !includesSeerr ? 'Because the existing SeerrNG container and these apps share a Docker network, use each service address below as its hostname.' : 'When SeerrNG runs in this Compose stack, use the service address below as its hostname.'} Use the listed container port. Leave SSL off unless you have configured TLS for that app.`,
    '',
  ];
  if (integrations.length) {
    for (const entry of integrations) lines.push(`- ${entry}`);
  } else {
    lines.push(
      'This profile does not include an automation service to link yet.'
    );
  }
  lines.push(
    '',
    'Web ports bind to this computer only. To reach a web interface from another device, deliberately change its host-side bind address after reviewing your network and authentication settings.'
  );
  if (selectedApps.includes('qbittorrent')) {
    lines.push(
      'qBittorrent also publishes peer traffic on TCP and UDP port 6881 on the Docker host so it can participate in torrent transfers.'
    );
  }
  if (selectedApps.includes('romarrng')) {
    lines.push(
      'After saving ROMarrNG, assign each supported system to **Retro** or **Modern** in SeerrNG before enabling emulation requests. ROMarrNG handles emulation requests; QuestarrNG handles PC game requests.'
    );
  }
  if (selectedApps.includes('chaptarrng')) {
    lines.push(
      'ChaptarrNG is an alternative Bookshelf-compatible provider. If one instance handles both formats, add both SeerrNG connections above with the same address and API key. Choose one provider per format to avoid duplicate acquisitions.'
    );
  }
  if (selectedApps.includes('backissue')) {
    lines.push(
      'The BackIssue image currently publishes a linux/amd64 container. On ARM64 hosts, Docker may need x86 emulation; use Mylar3 or Kapowarr for a native multi-architecture option.'
    );
  }
  if (selectedApps.includes('kapowarr')) {
    lines.push(
      'Kapowarr keeps its temporary downloads in `/app/temp_downloads` and uses its own GetComics and mirror sources; it does not use Prowlarr indexers.'
    );
  }
  const storageDetails = [];
  if (contentVolumeNames.size) {
    storageDetails.push(
      `content files in ${[...contentVolumeNames].map((name) => `\`${name}\``).join(', ')} named volumes`
    );
  }
  if (hasDownloadVolume) storageDetails.push('downloads in `downloads`');
  if (storageDetails.length) {
    const volumeMounts = selectedApps.flatMap((id) =>
      apps[id].volumes
        .filter((volume) => {
          const name = volume.split(':')[0];
          return name === 'downloads' || contentVolumeNames.has(name);
        })
        .map((volume) => `${apps[id].title} \`${volume.split(':')[1]}\``)
    );
    lines.push(
      '',
      `Docker manages ${storageDetails.join(' and ')}. Content and download volumes are mounted at ${volumeMounts.join(', ')}. Configure each app's root folders and download paths to match these mount points. Back up named volumes before moving this stack.`
    );
  }
  const portOverrides = selectedApps.map(
    (id) =>
      `\`${id.toUpperCase()}_HOST_PORT\` (default ${apps[id].hostPort ?? apps[id].port})`
  );
  if (selectedApps.includes('qbittorrent')) {
    portOverrides.push('`QBITTORRENT_PEER_PORT` (default 6881)');
  }
  lines.push(
    '',
    'Resolve host-port conflicts by setting the matching variable in a `.env` file in this folder: ' +
      `${portOverrides.join(', ')}. App-to-app container ports stay the same.`,
    ''
  );
  if (selectedApps.includes('qbittorrent')) {
    lines.splice(
      lines.length - 1,
      0,
      'Configure qBittorrent as the download client in each automation app that should use it. Use `qbittorrent` as its hostname, port `8080`, and the same `/downloads` path; enter the credentials configured in qBittorrent.'
    );
    lines.splice(
      lines.length - 1,
      0,
      'On first start, qBittorrent prints a temporary `admin` password in its container log. Sign in at http://localhost:8080 (or the host port you configured) and set a permanent password in the Web UI settings before connecting download clients.'
    );
  }
  return lines.join('\n');
};

export const parseComposeStatus = (output) => {
  const value = output.trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return value
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry && typeof entry === 'object');
  }
};

const runDocker = (args, options = {}) =>
  spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });

const parseDockerJson = (output, description) => {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Docker returned invalid ${description} JSON.`);
  }
};

const identifyApp = (container) => {
  const image = String(container.Config?.Image ?? container.Image ?? '')
    .toLowerCase()
    .replace(/@sha256:[a-f0-9]+$/, '')
    .replace(/:[^/]+$/, '');
  const composeService = String(
    container.Config?.Labels?.['com.docker.compose.service'] ?? ''
  ).toLowerCase();
  const name = String(container.Name ?? '')
    .replace(/^\//, '')
    .toLowerCase();

  for (const [id, app] of Object.entries(apps)) {
    const expectedImage = app.image.toLowerCase().replace(/:[^/]+$/, '');
    if (image === expectedImage) return id;
    if (composeService === id || name === id) {
      return id;
    }
  }

  return undefined;
};

const isSafeDockerHostname = (value) =>
  /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/.test(value);

export const discoverNetworkApps = (networkName, docker = runDocker) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(networkName ?? '')) {
    throw new Error('Provide a valid Docker network name with --network.');
  }
  const networkResult = docker(['network', 'inspect', networkName]);
  if (networkResult.error) throw networkResult.error;
  if (networkResult.status !== 0) {
    throw new Error(
      networkResult.stderr?.trim() ||
        `Docker could not inspect network ${networkName}.`
    );
  }
  const networkDocument = parseDockerJson(
    networkResult.stdout ?? '',
    'network inspection'
  );
  const network = Array.isArray(networkDocument)
    ? networkDocument[0]
    : networkDocument;
  if (!network || typeof network !== 'object') {
    throw new Error(`Docker network ${networkName} was not found.`);
  }
  const attached = Object.keys(network.Containers ?? {});
  if (attached.length > 64) {
    throw new Error(
      `Network ${networkName} has more than 64 attached containers; narrow discovery to a dedicated app network.`
    );
  }
  if (attached.length === 0) return [];

  const inspectResult = docker(['inspect', '--type', 'container', ...attached]);
  if (inspectResult.error) throw inspectResult.error;
  if (inspectResult.status !== 0) {
    throw new Error(
      inspectResult.stderr?.trim() ||
        'Docker could not inspect network containers.'
    );
  }
  const containers = parseDockerJson(
    inspectResult.stdout ?? '',
    'container inspection'
  );
  if (!Array.isArray(containers)) {
    throw new Error(
      'Docker returned an unexpected container inspection result.'
    );
  }

  return containers.flatMap((container) => {
    const id = identifyApp(container);
    if (!id) return [];
    const networkDetails =
      Object.entries(container.NetworkSettings?.Networks ?? {}).find(
        ([name, entry]) =>
          entry.NetworkID === network.Id || name === network.Name
      )?.[1] ?? {};
    const aliases = Array.isArray(networkDetails.Aliases)
      ? networkDetails.Aliases.filter(
          (alias) => typeof alias === 'string' && alias.length > 0
        )
      : [];
    const service = String(
      container.Config?.Labels?.['com.docker.compose.service'] ?? ''
    );
    const containerName = String(container.Name ?? '').replace(/^\//, '');
    const hostname = [
      service,
      ...aliases.filter((alias) => alias !== container.Id),
      containerName,
    ].find(isSafeDockerHostname);
    if (!hostname) return [];
    const reportedState = String(container.State?.Status ?? 'unknown');

    return [
      {
        id,
        title: apps[id].title,
        hostname,
        port: apps[id].port,
        state: /^[a-z]+$/.test(reportedState) ? reportedState : 'unknown',
      },
    ];
  });
};

export const renderDiscoveredConnections = (networkName, connections) => {
  const lines = [
    `# Detected SeerrNG connections on ${networkName}`,
    '',
    'These suggestions come from containers attached to the selected Docker network. Copy the hostname and port into the matching SeerrNG service form, enter that app’s API key, select **Test**, review the returned options, and save.',
    '',
    'Discovery does not read container environment variables, API keys, or app settings. It only identifies known images and Compose service aliases.',
    '',
  ];
  if (connections.length === 0) {
    lines.push(
      'No supported SeerrNG companion apps were found on this network.'
    );
  } else {
    for (const connection of connections) {
      lines.push(
        `- **${connection.title}** — hostname \`${connection.hostname}\`, port \`${connection.port}\` (${connection.state})`
      );
      if (connection.id === 'bookshelf' || connection.id === 'chaptarrng') {
        lines.push(
          '  Add separate Book and Audiobook service entries using the same hostname, port, and API key.'
        );
      }
      if (connection.id === 'questarrng' || connection.id === 'romarrng') {
        lines.push(
          '  Configure this provider under **Settings → Services → Software Acquisition**.'
        );
      }
      if (connection.id === 'prowlarr') {
        lines.push('  Configure this provider under **Settings → Prowlarr**.');
      }
    }
  }
  return `${lines.join('\n')}\n`;
};

const discoverAndReport = async (networkName, outputDirectory) => {
  const connections = discoverNetworkApps(networkName);
  if (connections.length === 0) {
    stdout.write(
      `No supported apps detected on Docker network ${networkName}.\n`
    );
  } else {
    stdout.write(`Detected apps on Docker network ${networkName}:\n`);
    for (const connection of connections) {
      stdout.write(
        `  ${connection.title}: hostname ${connection.hostname}, port ${connection.port} (${connection.state})\n`
      );
    }
  }

  if (outputDirectory)
    await writeConnectionReport(
      outputDirectory,
      { network: networkName, connections },
      renderDiscoveredConnections(networkName, connections)
    );
};

const writeConnectionReport = async (outputDirectory, document, guide) => {
  const resolvedDirectory = path.resolve(outputDirectory);
  await mkdir(resolvedDirectory, { recursive: true });
  const jsonPath = path.join(resolvedDirectory, 'seerrng-connections.json');
  const guidePath = path.join(resolvedDirectory, 'CONNECTIONS.md');
  await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    await writeFile(guidePath, guide, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await unlink(jsonPath).catch(() => {});
    throw error;
  }
  stdout.write(
    `Wrote private connection suggestions to ${resolvedDirectory}.\n`
  );
};

const createManualConnections = async (args, optionValue, rl) => {
  const nonInteractive = args.includes('--yes');
  let selectedIds = optionValue('--apps', '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!selectedIds.length) {
    if (nonInteractive) throw new Error('--yes requires --apps.');
    stdout.write(`Apps: ${connectionAppIds.join(', ')}\n`);
    selectedIds = (await rl.question('App IDs to connect (comma-separated): '))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  let hostname = optionValue('--host');
  if (!hostname) {
    if (nonInteractive) throw new Error('--yes requires --host.');
    hostname = await rl.question(
      'Hostname or IPv4 address reachable from SeerrNG (use localhost only when both services share a network namespace): '
    );
  }

  const portOverrides = {};
  if (!nonInteractive) {
    for (const id of [...new Set(selectedIds)]) {
      if (!connectionAppIds.includes(id)) {
        throw new Error(`Unknown or unsupported connection app "${id}".`);
      }
      const port = await rl.question(
        `${apps[id].title} port [${apps[id].port}]: `
      );
      if (port.trim()) portOverrides[id] = port.trim();
    }
  }
  const connections = buildManualConnections(
    hostname.trim(),
    selectedIds,
    portOverrides
  );
  const outputDirectory = optionValue('--output', './seerrng-connections');
  stdout.write(
    `\nConnections for ${hostname}:\n${connections.map((entry) => `  ${entry.title}: ${entry.hostname}:${entry.port}`).join('\n')}\nOutput: ${path.resolve(outputDirectory)}\n`
  );
  if (!nonInteractive) {
    const confirm = await rl.question('Write the connection report? [Y/n] ');
    if (/^(n|no)$/i.test(confirm.trim())) return;
  }
  await writeConnectionReport(
    outputDirectory,
    { source: 'manual', connections },
    renderManualConnections(hostname, connections)
  );
};

const probeHostAndReport = async (hostname, appIds, outputDirectory) => {
  const { openPorts, connections } = await probeKnownAppPorts(hostname, appIds);
  if (openPorts.length === 0) {
    stdout.write(
      `No common SeerrNG app ports accepted a TCP connection on ${hostname}. Use --connections to enter custom ports.\n`
    );
    return;
  }
  stdout.write(`Reachable common app ports on ${hostname}:\n`);
  for (const result of openPorts) {
    const labels = result.candidates.map((id) => apps[id].title).join(' / ');
    stdout.write(
      `  ${result.port}: ${labels}${result.candidates.length > 1 ? ' (ambiguous)' : ''}\n`
    );
  }
  if (connections.length === 0) {
    stdout.write(
      'No unambiguous suggestions to import. Use --connections to select the app and enter its port.\n'
    );
    return;
  }
  if (outputDirectory) {
    await writeConnectionReport(
      outputDirectory,
      { source: 'tcp-probe', connections },
      renderProbedConnections(hostname, openPorts, connections)
    );
  }
};

const detectComposeApps = async (outputDirectory) => {
  await access(path.join(outputDirectory, 'compose.yaml'));
  const result = spawnSync('docker', ['compose', 'ps', '--format', 'json'], {
    cwd: outputDirectory,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        `Docker Compose status check exited with ${result.status ?? 'unknown'}.`
    );
  }
  const containers = parseComposeStatus(result.stdout ?? '');
  if (containers.length === 0) {
    stdout.write(
      'No containers are currently detected in this Compose stack.\n'
    );
    return;
  }
  stdout.write('Detected Compose services:\n');
  for (const container of containers) {
    const service = container.Service ?? container.Name ?? 'Unknown service';
    const state = container.State ?? container.Status ?? 'unknown state';
    const health = container.Health ? ` (${container.Health})` : '';
    stdout.write(`  ${service}: ${state}${health}\n`);
  }
};

const help = () => {
  stdout.write(
    `SeerrNG setup assistant\n\nUsage: pnpm setup:assistant [options]\n\nOptions:\n  --profile <name>  choose a media profile (see --list-profiles)\n  --apps <changes>  add app IDs or remove with - (comma-separated)\n  --network <name>  join or discover apps on an explicitly named Docker network\n  --host <host>     target host for a manual connection report\n  --connections     create a manual report without requiring Docker\n  --probe-host <host> probe common app ports on one explicitly named host\n  --output <path>   output folder (default: ./seerrng-stack)\n  --yes             create files without interactive prompts\n  --start           start the stack after creating files\n  --detect          report containers in an existing Compose stack\n  --discover        identify supported apps attached to --network\n  --list-profiles   print available profiles\n  --help            show this help\n\nUse --connections to create an importable report for apps installed on Windows, macOS, Linux, or another reachable host. It does not require Docker.\nUse --probe-host <host> to check only the common default ports on one explicitly named host. TCP reachability is a suggestion, not app identification; API keys are never requested.\nUse --discover --network <name> for Docker discovery. API keys stay in each app and are entered in SeerrNG.\nWithout --profile, choose a Docker starter profile from the interactive menu.\n`
  );
};

const run = async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    help();
    return;
  }
  if (args.includes('--list-profiles')) {
    for (const [key, profile] of Object.entries(profiles)) {
      stdout.write(`${key}\t${profile.title}\n`);
    }
    return;
  }

  const optionValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };

  if (args.includes('--detect')) {
    const outputDirectory = path.resolve(
      optionValue('--output', './seerrng-stack')
    );
    try {
      await detectComposeApps(outputDirectory);
    } catch (error) {
      stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes('--discover')) {
    try {
      const networkName = optionValue('--network');
      if (!networkName) {
        throw new Error('--discover requires --network <name>.');
      }
      await discoverAndReport(
        networkName,
        args.includes('--output') ? optionValue('--output') : undefined
      );
    } catch (error) {
      stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes('--probe-host')) {
    try {
      const hostname = optionValue('--probe-host');
      if (!hostname) throw new Error('--probe-host requires a hostname.');
      const requestedApps = optionValue('--apps', '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      await probeHostAndReport(
        hostname,
        requestedApps.length ? requestedApps : connectionAppIds,
        optionValue('--output', './seerrng-connections')
      );
    } catch (error) {
      stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
    return;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    if (args.includes('--connections')) {
      await createManualConnections(args, optionValue, rl);
      return;
    }

    let profileName = optionValue('--profile');
    if (!profileName) {
      stdout.write('Choose a starter profile:\n');
      Object.entries(profiles).forEach(([key, profile], index) => {
        stdout.write(`  ${index + 1}. ${profile.title} (${key})\n`);
      });
      const answer = await rl.question('Profile number: ');
      profileName = Object.keys(profiles)[Number(answer) - 1];
    }

    const profile = profiles[profileName];
    if (!profile)
      throw new Error(`Unknown profile "${profileName}". Use --list-profiles.`);
    const selected = [...profile.apps];
    const nonInteractive = args.includes('--yes');
    if (nonInteractive && !optionValue('--profile')) {
      throw new Error('--yes requires --profile.');
    }
    let changes = optionValue('--apps', '');
    if (!nonInteractive && !changes) {
      stdout.write(
        `\nApps in this profile: ${selected.map((id) => `${id} (${apps[id].title})`).join(', ')}\n`
      );
      stdout.write(`Available app IDs: ${Object.keys(apps).join(', ')}\n`);
      changes = await rl.question(
        'Optional app IDs to add, or prefix with - to remove (comma-separated; Enter keeps this profile): '
      );
    }
    for (const change of changes
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      const remove = change.startsWith('-');
      const id = remove ? change.slice(1) : change;
      if (!apps[id]) throw new Error(`Unknown app "${id}".`);
      if (remove) {
        const index = selected.indexOf(id);
        if (index >= 0) selected.splice(index, 1);
      } else if (!selected.includes(id)) {
        selected.push(id);
      }
    }
    if (selected.length === 0) {
      throw new Error('Select at least one app for the Compose stack.');
    }
    const sharedNetwork = optionValue('--network');
    if (sharedNetwork && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(sharedNetwork)) {
      throw new Error(
        'Docker network names can contain letters, numbers, dots, underscores, and hyphens.'
      );
    }
    if (!selected.includes('seerrng') && !sharedNetwork) {
      throw new Error(
        'Removing SeerrNG requires --network <name> so your existing instance can reach the selected apps.'
      );
    }
    const outputDirectory = path.resolve(
      optionValue('--output', './seerrng-stack')
    );
    stdout.write(
      `\nSelected: ${profile.title}\nApps: ${selected.map((id) => apps[id].title).join(', ')}\nOutput: ${outputDirectory}\n`
    );
    const confirm = nonInteractive
      ? 'y'
      : await rl.question('Create the Compose stack and setup guide? [Y/n] ');
    if (/^(n|no)$/i.test(confirm.trim())) return;

    await mkdir(outputDirectory, { recursive: true });
    const composePath = path.join(outputDirectory, 'compose.yaml');
    const guidePath = path.join(outputDirectory, 'SETUP.md');
    const fileExists = await Promise.all(
      [composePath, guidePath].map(async (file) => {
        try {
          await access(file);
          return true;
        } catch (error) {
          if (error?.code === 'ENOENT') return false;
          throw error;
        }
      })
    );
    if (fileExists.some(Boolean)) {
      throw Object.assign(new Error('Output files already exist.'), {
        code: 'EEXIST',
      });
    }
    await writeFile(composePath, renderCompose(selected, sharedNetwork), {
      flag: 'wx',
    });
    try {
      await writeFile(
        guidePath,
        renderGuide(selected, profile.title, sharedNetwork),
        { flag: 'wx' }
      );
    } catch (error) {
      await unlink(composePath).catch(() => {});
      throw error;
    }
    stdout.write(
      '\nCreated compose.yaml and SETUP.md. Review SETUP.md, then run `docker compose up -d` from the output folder.\n'
    );
    const start = args.includes('--start')
      ? 'y'
      : nonInteractive
        ? 'n'
        : await rl.question('Start the stack now with Docker Compose? [y/N] ');
    if (/^(y|yes)$/i.test(start.trim())) {
      const result = spawnSync('docker', ['compose', 'up', '-d'], {
        cwd: outputDirectory,
        stdio: 'inherit',
      });
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(
          `Docker Compose exited with status ${result.status ?? 'unknown'}.`
        );
      stdout.write(
        'Stack started. Open http://localhost:5055 and follow SETUP.md to link the apps.\n'
      );
      await detectComposeApps(outputDirectory);
    }
  } catch (error) {
    if (error?.code === 'EEXIST') {
      stderr.write(
        'The output files already exist. Choose a new --output folder to avoid overwriting them.\n'
      );
    } else {
      stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    process.exitCode = 1;
  } finally {
    rl.close();
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await run();
}
