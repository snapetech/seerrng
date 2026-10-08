import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  validateCurrentBatchContract,
} = require('./check-current-batch-contract-lib.js');

const repositorySourceCache = new Map();
const repositoryFilesWith = (overrides = {}) =>
  new Proxy(overrides, {
    has: (target, key) =>
      typeof key === 'string' &&
      (Object.hasOwn(target, key) ||
        existsSync(new URL(`../${key}`, import.meta.url))),
    get: (target, key) => {
      if (typeof key !== 'string') return undefined;
      if (Object.hasOwn(target, key)) return target[key];
      if (!repositorySourceCache.has(key)) {
        repositorySourceCache.set(
          key,
          readFileSync(new URL(`../${key}`, import.meta.url), 'utf8')
        );
      }
      return repositorySourceCache.get(key);
    },
  });

test('Series request entry evidence follows actions rather than retired test titles', () => {
  const file = 'cypress/e2e/tv-details.cy.ts';
  const source = repositoryFilesWith()[file];
  const reason =
    'Series details must exercise one request-screen entry, in-dialog HD and 4K choices and observed zero submissions';
  const passes = (changed) =>
    !validateCurrentBatchContract(
      repositoryFilesWith({ [file]: changed })
    ).some((error) => error.includes(reason));
  assert.equal(passes(source), true, 'actual entry/quality/no-write evidence');
  assert.equal(
    passes(
      source.replace(
        'opens one request screen and chooses HD or 4K inside it without submitting',
        'an independently named behavioral test'
      )
    ),
    true,
    'test title is not the contract'
  );
  assert.equal(
    passes(source.replaceAll('submissions', 'observedWrites')),
    true,
    'counter identifier is not the contract'
  );
  const mutations = [
    ['POST observer', "cy.intercept('POST'", "cy.intercept('GET'"],
    ['request endpoint', "'/api/v1/request*'", "'/api/v1/unrelated*'"],
    ['write observation', 'submissions += 1;', 'submissions += 0;'],
    ['fresh counter', 'let submissions = 0;', 'let submissions = 1;'],
    ['zero assertion', ').to.eq(0)', ').to.eq(1)'],
    ['queued zero assertion', 'cy.then(() =>', 'immediateAssertion(() =>'],
    ['entry action', ".filter(':visible')", ".filter(':hidden')"],
    ['entry enabled', ".should('be.enabled')", ".should('be.disabled')"],
    [
      'entry click',
      ".should('be.enabled')\n      .click();",
      ".should('be.enabled');",
    ],
    [
      'dialog owner',
      'cy.get(\'[role="dialog"]\')',
      'cy.get(\'[role="region"]\')',
    ],
    [
      'visible dialog',
      ".should('be.visible')\n      .within",
      ".should('not.be.visible')\n      .within",
    ],
    [
      'quality owner',
      '[role="group"][aria-label="Quality"]',
      '[role="group"][aria-label="Other"]',
    ],
    ['HD choice', '/^HD$/', '/^SD$/'],
    ['4K choice', '/^4K$/', '/^8K$/'],
    [
      '4K choice action',
      ".should('be.enabled')\n          .click();",
      ".should('be.enabled');",
    ],
    ['selected state', "'aria-pressed', 'true'", "'aria-pressed', 'false'"],
    ['retired control absence', ".should('not.exist');", ".should('exist');"],
    [
      'return to HD',
      ".click()\n          .should('have.attr', 'aria-pressed', 'true');",
      ".should('have.attr', 'aria-pressed', 'true');",
    ],
  ];
  for (const [edge, before, after] of mutations) {
    assert.ok(
      source.includes(before),
      `${edge}: mutation matches actual source`
    );
    assert.equal(
      passes(source.replaceAll(before, after)),
      false,
      `${edge}: missing behavioral edge fails closed`
    );
  }
  const movieFile = 'cypress/e2e/movie-details.cy.ts';
  assert.ok(
    validateCurrentBatchContract(
      repositoryFilesWith({
        [movieFile]: repositoryFilesWith()[movieFile].replace(
          'shows standard and 4K requests in one segmented control',
          'removed Movie segmented evidence'
        ),
      })
    ).some((error) =>
      error.includes(
        'Movie details must test the shared segmented request control'
      )
    ),
    'Movie segmented behavior remains required'
  );
});

test('upstream public commands preserve build-time translation and visual guards', () => {
  const packageSource = repositoryFilesWith()['package.json'];
  const baseline = validateCurrentBatchContract(repositoryFilesWith());
  assert.deepEqual(
    baseline,
    [],
    'the actual source passes all current contracts'
  );
  const cases = [
    ['build', 'pnpm build:compile', 'upstream build-all entry point'],
    ['build:all', 'run-p build:next', 'compile both client and server'],
    ['build:next', 'echo skipped', 'upstream Next compiler'],
    [
      'build:server',
      'echo skipped',
      'upstream compilation, resources and alias resolution',
    ],
    [
      'prebuild',
      'pnpm current-batch:check',
      'translation and current-batch checks',
    ],
    ['prebuild', 'pnpm i18n:check', 'translation and current-batch checks'],
    [
      'prebuild',
      'pnpm i18n:check; pnpm current-batch:check',
      'translation and current-batch checks',
    ],
    [
      'current-batch:check',
      'node bin/check-current-batch-contract.js',
      'fail closed on shared visual checks',
    ],
    [
      'current-batch:check',
      'node bin/check-current-batch-contract.js; pnpm ui-style:check',
      'fail closed on shared visual checks',
    ],
    [
      'ui-style:check',
      'node --test src/styles/buttonGeometry.test.mjs',
      'retain style, control-geometry, and Sportarr role checks',
    ],
    [
      'ui-style:check',
      'node bin/check-refreshed-ui-style.js',
      'retain style, control-geometry, and Sportarr role checks',
    ],
    [
      'ui-style:check',
      'node bin/check-refreshed-ui-style.js; node --test src/styles/buttonGeometry.test.mjs',
      'retain style, control-geometry, and Sportarr role checks',
    ],
    [
      'i18n:check',
      'echo skipped',
      'translation command must retain its actual validator',
    ],
    ['dev', 'echo skipped', 'upstream watched server entry point'],
    ['prebuild', undefined, 'translation and current-batch checks'],
    ['current-batch:check', false, 'fail closed on shared visual checks'],
  ];
  for (const [name, replacement, reason] of cases) {
    const changed = JSON.parse(packageSource);
    changed.scripts[name] = replacement;
    assert.ok(
      validateCurrentBatchContract(
        repositoryFilesWith({ 'package.json': JSON.stringify(changed) })
      ).some((error) => error.includes(reason)),
      `${name}: ${reason}`
    );
  }
});

test('current shared owners pass their checks and functional mutations fail', () => {
  const cases = [
    [
      'src/components/MediaDetails/MusicRatings.tsx',
      'getSafeHref(rating?.url)',
      'rating?.url',
      'music rating links must pass through the shared safe URL boundary',
    ],
    [
      'src/components/MediaDetails/MediaQualitySelect.tsx',
      'if (!option.disabled) onChange(option.value);',
      'onChange(option.value);',
      'detail quality options must not activate unavailable formats',
    ],
    [
      'src/components/Requests/destructiveActions.tsx',
      'okDisabled={disabled || busy}',
      'okDisabled={disabled}',
      'request deletion confirmations must preserve shared surfaces and busy-write guards',
    ],
    [
      'src/components/ManageSlideOver/ManageMediaActions.tsx',
      'issuesExpanded && canViewIssues && issues.length > 0',
      'issuesExpanded && issues.length > 0',
      'media management must guard the expandable Issue list by permission and availability',
    ],
    [
      'src/components/CollectionDetails/index.tsx',
      '(part) => !hasManualPlaybackSelection || selectedMediaIds.includes(part.id)',
      '() => true',
      'Collection playback must preserve oldest-first ordering and an intentionally empty selection',
    ],
    [
      'src/styles/globals.css',
      '--app-card-frame-background: var(--palette-blue, #0051d4);',
      '--app-card-frame-background: conic-gradient(#252a30, #f8fafb);',
      'card borders must preserve the shared rounded silhouette and solid blue ring',
    ],
    [
      'src/styles/globals.css',
      '.app-button-playback:hover {\n    border-color: rgb(var(--color-gray-200));',
      '.app-button-playback:hover {\n    border-color: rgb(var(--color-gray-600));',
      'playback buttons must restore the bright hover border without changing their black surface',
    ],
    [
      'src/styles/globals.css',
      '.media-request-submit-action {\n    margin-inline-start: auto;',
      '.media-request-submit-action {\n    margin-inline-start: 0;',
      'detail Request controls must remain right-justified opposite Search Prowlarr',
    ],
    [
      'src/styles/visual-lab.css',
      '.gradiant-text {\n  width: fit-content;\n  background-image: linear-gradient(',
      ".gradiant-text {\n  width: fit-content;\n  background-image: url('/visual-lab/legacy-title-fill.png');\n  background: linear-gradient(",
      'Visual Lab treatments must remain CSS-only without image-backed fills',
    ],
  ];
  for (const [fileName, original, replacement, reason] of cases) {
    const source = readFileSync(
      new URL(`../${fileName}`, import.meta.url),
      'utf8'
    );
    assert.ok(source.includes(original), `${fileName}: mutation target exists`);
    assert.ok(
      !validateCurrentBatchContract(
        repositoryFilesWith({ [fileName]: source })
      ).some((error) => error.includes(reason)),
      reason
    );
    assert.ok(
      validateCurrentBatchContract(
        repositoryFilesWith({
          [fileName]: source.replace(original, replacement),
        })
      ).some((error) => error.includes(reason)),
      reason
    );
  }
});

test('accepted poster, tree, and shared ownership contracts reject functional regressions', () => {
  const tree = 'src/components/MediaDetails/SeasonEpisodeTree.tsx';
  const browser = 'src/components/MediaDetails/SeriesSeasonEpisodeBrowser.tsx';
  const css = 'src/styles/globals.css';
  const cases = [
    [
      css,
      'width: var(--poster-width);',
      'width: 100%;',
      'poster width must remain fixed through the shared poster-width token',
    ],
    [
      'src/components/Discover/index.tsx',
      '<>',
      '<div className="discover-home">',
      'ordinary browsing wrappers must not activate legacy Lab-only enlarging poster geometry',
    ],
    [
      tree,
      'disabled={disabled || !isTreeEpisodeSelectable(episode)}',
      'disabled={false}',
      'ineligible episodes must remain visible but cannot be selected',
    ],
    [
      tree,
      'if (!isTreeEpisodeSelectable(episode)) return;',
      '',
      'episode selection handlers must reject ineligible episodes',
    ],
    [
      tree,
      'partial={state.partial}',
      'partial={false}',
      'Series playback season rows must show partial episode selection',
    ],
    [
      tree,
      'useState<number[]>([])',
      'useState<number[]>([1])',
      'selection trees must start collapsed',
    ],
    [
      tree,
      'data-tree-part="episode-selection"',
      'data-tree-part="episode-title-only"',
      'episode selection must cover circle, number, and title',
    ],
    [
      tree,
      '{columnHeadings()}',
      '',
      'Series headings and feedback must remain outside and before the scrolling selectable rows',
    ],
    [
      tree,
      'className="scrollable-card"',
      'className="scrollable-card scrollable-card"',
      'Series selection must use one shared scroll viewport',
    ],
    [
      browser,
      'treeSelectionToPlaybackIds(treeData.playbackIdsByEpisode, ids)',
      'ids',
      'tree selection must map only catalog-authorized episode identities',
    ],
    [
      browser,
      'selectedTreeEpisodeIds(',
      'unsafeSelectionIds(',
      'Series playback selection must map provider item IDs back to tree episode identities',
    ],
    [
      'src/components/TvDetails/SeriesDetailsLayout.tsx',
      'data-testid="media-details-genres"',
      'data-testid="unrelated-value"',
      'Series Genres must attach the shared wrapping value role to the actual Genres cell',
    ],
    [
      css,
      'margin-inline-start: auto;',
      'margin-inline-start: 0;',
      'page progress must remain right justified',
    ],
    [
      'bin/local-validation.mjs',
      "['Shared visual standard', 'bin/check-refreshed-ui-style.js']",
      "['Shared visual standard', 'bin/removed-style-check.js']",
      'the cumulative runner must discover current-batch and shared-style checks',
    ],
  ];
  const baseline = validateCurrentBatchContract(repositoryFilesWith());
  for (const [fileName, original, replacement, reason] of cases) {
    const source = repositoryFilesWith()[fileName];
    assert.ok(
      source.includes(original),
      `mutation target exists: ${fileName} ${original}`
    );
    assert.ok(
      !baseline.some((error) => error.includes(reason)),
      `current owner passes: ${reason}`
    );
    // Replace every same-owner occurrence so unrelated consumers cannot mask it.
    const changed = source.replaceAll(original, replacement);
    assert.ok(
      validateCurrentBatchContract(
        repositoryFilesWith({ [fileName]: changed })
      ).some((error) => error.includes(reason)),
      reason
    );
  }
  const source = repositoryFilesWith()[tree];
  for (const heading of [
    'export const seasonSelection =',
    'export const toggleSeasonSelection =',
    'const availableIds =',
  ]) {
    const offset = source.indexOf(heading);
    const target = source.indexOf('.filter(isTreeEpisodeSelectable)', offset);
    assert.ok(offset >= 0 && target >= offset, heading);
    const changed =
      source.slice(0, target) +
      source
        .slice(target)
        .replace('.filter(isTreeEpisodeSelectable)', '.filter(() => true)');
    assert.ok(
      validateCurrentBatchContract(
        repositoryFilesWith({ [tree]: changed })
      ).some((error) =>
        error.includes(
          'season and global selection sets must exclude ineligible episodes'
        )
      ),
      heading
    );
  }
});

test('accepted semantic request owners satisfy every reconciled build diagnostic', () => {
  const selector = 'src/components/Selector/index.tsx';
  const errors = validateCurrentBatchContract(
    repositoryFilesWith({
      [selector]: repositoryFilesWith()[selector],
    })
  );
  for (const reason of [
    'disabled buttons must be darkened and use the prohibited cursor',
    'long root-folder tables must scroll their data rows',
    'root-folder table rules must use the dark Destination Server color',
    'Request Series must reuse the shared request site canvas and inset artwork card',
    'detail quality controls must vertically center their text and icons',
    'segmented quality controls must visibly highlight the selected available format',
    'ineligible episodes must remain visible but cannot be selected',
    'episode selection handlers must reject ineligible episodes',
    'tree select-all must be disabled when no eligible episodes exist',
    'season and global selection sets must exclude ineligible episodes',
    'interactive selection controls must use SelectionCircle instead of embedding CheckCircleIcon',
    'root folder and available space columns must be adjacent and content-sized',
    'request artwork must be clipped inside the full main card',
    'request artwork must fill the full card from the top edge',
    'request artwork must use the shared scrim',
    'Series new and pending requests must use the same site canvas as other media',
    'media inset and table headings must use their shared mode-aware typography',
  ])
    assert.ok(!errors.some((error) => error.includes(reason)), reason);
});

test('native request CSS accepts declaration order but rejects diagnostic-specific lost and competing owners', () => {
  const file = 'src/styles/globals.css';
  const source = repositoryFilesWith()[file];
  const selectorFile = 'src/components/Selector/index.tsx';
  const normalize = (text) => text.replace(/\s+/g, ' ').trim();
  const fails = (css, reason) =>
    validateCurrentBatchContract(
      repositoryFilesWith({
        [file]: css,
        [selectorFile]: repositoryFilesWith()[selectorFile],
      })
    ).some((error) => error.includes(reason));
  const cases = [
    ['.app-button:disabled', 'opacity', 'disabled buttons must be darkened'],
    ['.poster-control:disabled', 'cursor', 'disabled buttons must be darkened'],
    [
      ".card-table[data-table-layout='request-folders'] [data-scrollable='true']",
      'max-height',
      'long root-folder tables must scroll their data rows',
    ],
    [
      ".card-table[data-table-layout='request-folders'] [data-scrollable='true']",
      'overflow-y',
      'long root-folder tables must scroll their data rows',
    ],
    [
      ".card-table[data-table-layout='request-folders'] [data-table-part='header']",
      'border-bottom',
      'root-folder table rules must use the dark Destination Server color',
    ],
    [
      ".card-table[data-table-layout='request-folders']",
      '--card-table-columns',
      'root folder and available space columns must be adjacent and content-sized',
    ],
    [
      ".card-table[data-table-layout='request-folders'] [data-table-part='rows']",
      'grid-template-columns',
      'root folder and available space columns must be adjacent and content-sized',
    ],
    [
      '.format-request-label',
      'align-items',
      'detail quality controls must vertically center',
    ],
    [
      '.format-request-option',
      'display',
      'detail quality controls must vertically center',
    ],
    [
      ".format-request-option[aria-pressed='true']:not(:disabled)",
      'background-color',
      'segmented quality controls must visibly highlight',
    ],
    [
      ".format-request-option[aria-pressed='true']:not(:disabled)",
      'box-shadow',
      'segmented quality controls must visibly highlight',
    ],
    [
      '.media-detail-card',
      'overflow',
      'request artwork must be clipped inside the full main card',
    ],
    [
      '.media-detail-artwork-layer',
      'inset',
      'request artwork must be clipped inside the full main card',
    ],
    [
      '.media-detail-artwork-image',
      'object-fit',
      'request artwork must fill the full card from the top edge',
    ],
    [
      '.card-layout',
      '--card-artwork-position',
      'request artwork must fill the full card from the top edge',
    ],
    [
      '.refreshed-artwork-scrim',
      'background-color',
      'request artwork must use the shared scrim',
    ],
    [
      '.request-modal-site-surface',
      'max-width',
      'Series new and pending requests must use the same site canvas',
    ],
    [
      '.media-inset-heading',
      'font-size',
      'media inset and table headings must use their shared mode-aware typography',
    ],
    [
      '.media-inset-table-heading',
      'line-height',
      'media inset and table headings must use their shared mode-aware typography',
    ],
    [
      ".provider-container > [data-provider-region='check']",
      'pointer-events',
      'interactive selection controls must use SelectionCircle',
    ],
  ];
  for (const [selector, property, reason] of cases) {
    const ast = require('postcss').parse(source);
    let changed = 0;
    ast.walkRules((rule) => {
      if (!rule.selectors.some((item) => normalize(item) === selector)) return;
      rule.walkDecls(property, (decl) => {
        changed++;
        decl.remove();
      });
    });
    assert.ok(changed, `${selector} ${property}: mutation target exists`);
    assert.equal(
      fails(ast.toString(), reason),
      true,
      `lost ${selector} ${property} fails`
    );
  }
  const ordered = require('postcss').parse(source);
  ordered.walkRules((rule) => {
    if (
      !cases.some(([selector]) =>
        rule.selectors.some((item) => normalize(item) === selector)
      )
    )
      return;
    const nodes = [...rule.nodes];
    rule.removeAll();
    for (const node of nodes.reverse()) rule.append(node);
  });
  for (const [, , reason] of cases)
    assert.equal(
      fails(ordered.toString(), reason),
      false,
      `native declaration order does not alter ${reason}`
    );
  for (const [rule, reason] of [
    [
      '.app-button:disabled { opacity: 1; }',
      'disabled buttons must be darkened',
    ],
    [
      '.format-request-label { @apply items-start; }',
      'detail quality controls must vertically center',
    ],
    [
      ".format-request-option[aria-pressed='true']:not(:disabled) { background: transparent; }",
      'segmented quality controls must visibly highlight',
    ],
    [
      ".card-table[data-table-layout='request-folders'] [data-table-part='header'] { border: 0; }",
      'root-folder table rules must use the dark Destination Server color',
    ],
    [
      '.media-inset-table-heading { font: inherit; }',
      'media inset and table headings must use their shared mode-aware typography',
    ],
    [
      '.media-detail-card { overflow: visible; }',
      'request artwork must be clipped inside the full main card',
    ],
  ])
    assert.equal(
      fails(`${source}\n${rule}`, reason),
      true,
      `competing owner fails: ${rule}`
    );
});

test('semantic request JSX rejects lost owners, eligibility overrides, and counterfeit provider exceptions', () => {
  const cases = [
    [
      'src/components/RequestModal/AdvancedRequester/index.tsx',
      'data-table-part="rows"',
      'data-table-part="retired-rows"',
      'long root-folder tables must scroll their data rows',
    ],
    [
      'src/components/RequestModal/AdvancedRequester/index.tsx',
      'data-table-part="header"',
      'data-table-part="retired-header"',
      'root-folder table rules must use the dark Destination Server color',
    ],
    [
      'src/components/RequestModal/AdvancedRequester/index.tsx',
      'data-table-layout="request-folders"',
      'data-table-layout="other"',
      'root folder and available space columns must be adjacent and content-sized',
    ],
    [
      'src/components/RequestModal/TvRequestModal.tsx',
      'dialogClass="request-modal-site-surface"',
      'dialogClass="legacy-canvas"',
      'Series new and pending requests must use the same site canvas',
    ],
    [
      'src/components/RequestModal/TvRequestModal.tsx',
      'app-card-inset refreshed-inset-surface detail-summary-card',
      'detail-summary-card',
      'Request Series must reuse the shared request site canvas and inset artwork card',
    ],
    [
      'src/components/RequestModal/RequestMediaCard.tsx',
      'app-card-main',
      'app-card-inset',
      'request artwork must be clipped inside the full main card',
    ],
    [
      'src/components/RequestModal/RequestMediaCard.tsx',
      'src={artwork}',
      'src="unrelated"',
      'request artwork must fill the full card from the top edge',
    ],
    [
      'src/components/MediaDetails/MediaDetailArtwork.tsx',
      '\n        fill\n',
      '\n',
      'request artwork must fill the full card from the top edge',
    ],
    [
      'src/components/MediaDetails/MediaDetailArtwork.tsx',
      'className="refreshed-artwork-scrim"',
      'className="retired-scrim"',
      'request artwork must use the shared scrim',
    ],
    [
      'src/components/MediaDetails/SeasonEpisodeTree.tsx',
      'episode.selectable ?? episode.available',
      'episode.selectable || episode.available',
      'ineligible episodes must remain visible but cannot be selected',
    ],
    [
      'src/components/MediaDetails/SeasonEpisodeTree.tsx',
      'disabled={disabled || availableIds.size === 0}',
      'disabled={disabled}',
      'tree select-all must be disabled when no eligible episodes exist',
    ],
    [
      'src/components/Selector/index.tsx',
      'data-selected={isActive}',
      'data-selected={true}',
      'interactive selection controls must use SelectionCircle',
    ],
    [
      'src/components/Selector/index.tsx',
      'data-provider-region="logo"',
      'data-provider-region="unknown"',
      'interactive selection controls must use SelectionCircle',
    ],
    [
      'src/components/Selector/index.tsx',
      'onClick={() => toggleProvider(provider.id)}',
      'onClick={() => toggleProvider(0)}',
      'interactive selection controls must use SelectionCircle',
    ],
    [
      'src/components/Selector/index.tsx',
      '{isActive && (',
      '{true && (',
      'interactive selection controls must use SelectionCircle',
    ],
    [
      'src/components/Selector/index.tsx',
      'aria-label={provider.name}',
      'aria-label="unrelated"',
      'interactive selection controls must use SelectionCircle',
    ],
  ];
  for (const [file, original, replacement, reason] of cases) {
    const source = repositoryFilesWith()[file];
    assert.ok(
      source.includes(original),
      `${file}: mutation target exists: ${original}`
    );
    assert.ok(
      !validateCurrentBatchContract(
        repositoryFilesWith({ [file]: source })
      ).some((error) => error.includes(reason)),
      `accepted owner passes: ${reason}`
    );
    assert.ok(
      validateCurrentBatchContract(
        repositoryFilesWith({
          [file]: source.replaceAll(original, replacement),
        })
      ).some((error) => error.includes(reason)),
      `lost relationship fails: ${reason}`
    );
  }
  const unexpected = 'src/components/TestUnexpectedSelection.tsx';
  assert.ok(
    validateCurrentBatchContract(
      repositoryFilesWith({
        [unexpected]:
          'const Other = () => <button aria-pressed={true}><CheckCircleIcon /></button>;',
      })
    ).some(
      (error) =>
        error.startsWith(`${unexpected}:`) &&
        error.includes(
          'interactive selection controls must use SelectionCircle'
        )
    )
  );
});

test('reports missing files instead of silently skipping contract checks', () => {
  const errors = validateCurrentBatchContract({});
  assert.ok(errors.some((error) => error.includes('Missing contract input:')));
});

test('Docker keeps the host npm configuration out of the build context', () => {
  const dockerfile = readFileSync(
    new URL('../Dockerfile', import.meta.url),
    'utf8'
  );
  const ignoreRules = readFileSync(
    new URL('../.dockerignore', import.meta.url),
    'utf8'
  );
  const validErrors = validateCurrentBatchContract(
    repositoryFilesWith({
      Dockerfile: dockerfile,
      '.dockerignore': ignoreRules,
    })
  );
  assert.ok(
    !validErrors.some((error) => error.includes('without copying .npmrc')),
    validErrors.join('\n')
  );

  const weakInstallErrors = validateCurrentBatchContract(
    repositoryFilesWith({
      Dockerfile: dockerfile.replace(
        'pnpm --config.engine-strict=true install --prod --frozen-lockfile',
        'pnpm install --prod --frozen-lockfile'
      ),
    })
  );
  assert.ok(
    weakInstallErrors.some((error) =>
      error.includes(
        'production dependency installation must keep strict engine checks'
      )
    )
  );

  const exposedConfigErrors = validateCurrentBatchContract(
    repositoryFilesWith({ '.dockerignore': `${ignoreRules}\n!/.npmrc\n` })
  );
  assert.ok(
    exposedConfigErrors.some((error) =>
      error.includes('must not re-include host package-manager configuration')
    )
  );
});

test('reports a button-order regression', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('/index.tsx')
          ? 'buttonType="reportIssue" <ExclamationTriangleIcon /> </Button> buttonType="manage" buttonType="blocklist" buttonSize="sm"'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'detail actions must begin Blocklist, Manage, then Report an Issue'
      )
    )
  );
});

test('reports a shared selection-circle asset regression', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/RequestModal/TvRequestModal.tsx')
          ? '<RequestMediaCard'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'selector component must render its shared selection glyph rather than import availability artwork'
      )
    )
  );
});

test('rejects the defective selector pattern in any component', () => {
  const errors = validateCurrentBatchContract({
    'src/components/UnexpectedSelector/index.tsx':
      '<button aria-pressed={selected}><CheckCircleIcon /></button>',
  });
  assert.ok(
    errors.some((error) =>
      error.includes(
        'interactive selection controls must use SelectionCircle instead of embedding CheckCircleIcon'
      )
    )
  );
});

test('reports an incomplete Books discovery navigation contract', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);
  assert.ok(
    errors.some((error) =>
      error.includes(
        'Books discovery must preserve the All Books, Books, Audiobooks format order'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'the Book poster-card Request action must navigate to the auto-open Details flow'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'an empty default all-books provider response must surface as a provider failure'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'book discovery must retire browser cache entries created under the old stale-empty response contract'
      )
    )
  );
});

test('reports incomplete primary navigation cleanup', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).includes('Layout/Sidebar') ||
        String(key).includes('Layout/MobileMenu')
          ? "href: '/discover/audiobooks' href: '/discover/audiobooks' href: '/requests/status'"
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  assert.ok(
    errors.some((error) =>
      error.includes(
        'primary navigation must contain exactly one Audiobooks entry'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'primary navigation must not contain the removed Request Status entry'
      )
    )
  );
  assert.ok(
    errors.some((error) =>
      error.includes(
        'primary navigation must retain exactly one main Requests entry'
      )
    )
  );
});

test('reports filter-control and reset regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'compact discovery selectors must override the white third-party control surface',
    'Clear Filters must restore the default sort order on every filtered page',
    'Movie and Series Genres must load the complete type-specific option list',
    'Movie and Series Genres must use the same shared single-value dropdown as neighboring filters',
    'the style standard must preserve meaningful filtering behavior while refactoring presentation',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('rejects the former Movie and Series Genres multi-select', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/Discover/FilterPanel/index.tsx')
          ? "<GenreSelector isMulti onChange={(value) => updateFilter('genre', value?.map((v) => v.value).join(','))} />"
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'Movie and Series Genres must not restore the multi-select control',
    'Movie and Series Genres must not concatenate multiple selections',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports refreshed Users page contract regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/UserList/index.tsx')
          ? '<PaginationFooter><Table.TH><input id="selectAll" type="checkbox" className="w-full" />'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'the Users page must use the standardized card, filters, sorts, scrollable table, and actions',
    'the Users table must use shared selection circles for select-all and row selection',
    'the Users table must load one scrollable user set instead of paging the page',
    'the Users page must not restore pagination, legacy table controls, native row checkboxes, or full-width actions',
    'Users table geometry, typography, and divider styling must resolve through shared global classes',
    'the style standard must govern shared card arrangement rather than page-specific copies',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports shared Settings shell and group regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/Settings/SettingsLayout.tsx')
          ? '<div className="mt-10 text-white">{children}</div>'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'every Settings route must use the shared shell, navigation, actions, and unsaved-change workflow',
    'Settings content must not restore the uncontained legacy layout',
    'Settings route navigation must reuse the shared filter-button component styling',
    'General Settings and Playlist Integrations must be separate standard subcards',
    'Settings layout, groups, actions, and change state must resolve through shared global classes',
    'the style standard must govern shared page-shell ownership',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('rejects legacy Blocklist divider tracks and standalone divider elements', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/Blocklist/index.tsx')
          ? 'grid-cols-[max-content_0.75rem_6rem_1px_0.75rem_minmax(0,1fr)] card:block hidden bg-gray-600'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'both Blocklist card detail separators must use the shared owning-column border class',
    'Blocklist cards must not restore the legacy one-pixel divider track',
    'Blocklist cards must not insert a separate gray divider element',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports Issue divider and compact status badge regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'Affected Episodes headings must use the shared two-pixel dark table divider',
    'Issue status badges must use the shared compact detail-status geometry',
    'Blocklist source badges must share the compact Issue-status geometry',
    'compact Issue and Blocklist badge geometry and colors must resolve through shared global classes',
    'the style standard must preserve responsive divider geometry',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports Global Search progress positioning regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'Global Search progress must feed the shared page-status display',
    'Global Search and page loading progress must reference the same page-status style',
    'page title and progress must share one aligned layout row',
    'page progress must remain right justified in the shared page-title row',
    'the shared UI standard must govern the one shared page-status asset',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports shared modal screen-backdrop regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('Common/Modal/index.tsx') ? 'bg-gray-800/70' : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'every shared modal must reference the site-wide screen-backdrop style',
    'the shared modal must not restore the blue-gray screen tint',
    'the shared modal backdrop must use the approved less-transparent black layer',
    'the shared UI standard must preserve the site-wide modal backdrop treatment',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports poster Associations style drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  assert.ok(
    errors.some((error) =>
      error.includes(
        'the poster Associations action must use the independent poster-control style'
      )
    )
  );
});

test('reports Associations result navigation and redundant status regressions', () => {
  const missingWiring = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const wiringErrors = validateCurrentBatchContract(missingWiring);

  for (const expected of [
    'the shared association detail card must expose one navigation-close callback',
    'both the association poster and title links must invoke the shared navigation-close callback',
    'every Associations popup result group must pass through the navigation-close callback',
    'selecting an Associations popup result must close the popup as navigation begins',
    'collection association links must close their popup as navigation begins',
  ]) {
    assert.ok(
      wiringErrors.some((error) => error.includes(expected)),
      expected
    );
  }

  const redundantStatus = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('AssociationDetailCard.tsx')
          ? '<dt>Status:</dt>'
          : '',
    }
  );
  const statusErrors = validateCurrentBatchContract(redundantStatus);
  assert.ok(
    statusErrors.some((error) =>
      error.includes(
        'association detail cards must not repeat a separate Status heading or value'
      )
    )
  );
});

test('reports poster availability control drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'poster quality states must use the shared rounded status badge',
    'poster quality states must match the rounded media-type badge silhouette',
    'available poster qualities must place the outlined availability icon after the green quality label',
    'poster overlays must use shared media-type, saved-item, association, quality, and watched-status slots without local layout utilities',
    'music posters must preserve separate MP3 and FLAC request states',
    'pending bell and processing timer badges must explain their meaning in tooltips',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports persistent detail disclosure pin contract drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'detail disclosure pins must expose their selected state',
    'detail disclosure pins must use the authenticated category-scoped per-user settings endpoint',
    'detail disclosure pin settings must expose one read and one write route',
    'the disclosure row must consume the shared spacing role',
    'the Subject Tags pin must carry into Music details',
    'refreshed inset cards must use the darker translucent control surface without changing outer cards',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports request-card contrast and Advanced Options contract drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/RequestModal/TvRequestModal.tsx')
          ? '<RequestMediaCard backdropFull'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'request controls must use the shared dropdown treatment',
    'request table and details dividers must use the shared theme border color',
    'detail columns must own their responsive vertical divider border',
    'detail columns must resolve through the shared divider class',
    'root-folder scrolling must begin only after five rows',
    'Destination Server, Metadata Profile, Quality Profile, Root Folder, and Language must all use the shared request listbox',
    'Root Folder must use the shared request listbox with its selected path',
    'request listbox menus must mark their selected option with a check icon',
    'request dropdown color, geometry, and selection styling must live in shared global classes',
    'fresh request forms must open Advanced Options by default',
    'full-size request cards must use the site background gradient',
    'Request Series must reuse the shared request site canvas and inset artwork card',
    'Request Series must keep artwork in the media card, not behind the page heading',
    'Report Issue and Request Series must share one main-card layout class',
    'Report Issue and Request Series must consume the same main-card layout class',
    'artwork forms must leave vertical scrolling on the full modal viewport rather than the main card',
    'request-edit Close actions must use the shared red danger treatment',
    'the Series request-edit Close action must use the shared red danger treatment',
    'request cards must resolve wrapping action alignment through the shared global style',
    'request action rows must remain fully justified',
    'the style standard must govern shared custom select ownership and semantics',
    'the style standard must govern justified wrapping action-row layout',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('rejects legacy Issue card divider tracks and elements', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/IssueList/IssueItem/index.tsx')
          ? 'media-detail-column-divider media-detail-column-divider card:grid-cols-[max-content_0.75rem_6rem_0.75rem_1px_0.75rem_minmax(0,1fr)] card:block hidden bg-gray-600'
          : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'Issue cards must not restore the legacy one-pixel divider track',
    'Issue cards must not insert a separate gray divider element',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports Firefox dynamic detail-artwork contract drift', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'artwork-backed detail cards must use the stable shared artwork layer',
    'the Firefox artwork fallback must reuse the resolved cached image URL',
    'the dynamic artwork workaround must remain Firefox-specific',
    'Firefox must render expanding detail artwork through a stable background layer',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports recovered visual-contract and evidence-provenance regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'the style standard must govern filter section placement and wrapping',
    'the style standard must govern truthful filter reset behavior',
    'the style standard must preserve truthful status and action eligibility',
    'the historical visual audit must not claim current render evidence for post-r3 source',
    'Request Status task summaries must retain the approved single-row order',
    'request forms must render Approval in their details grid',
    'request admission must identify a matching promotable pending request',
    'matching-pending promotion must retain cross-media route coverage',
    'request forms must permit authorized matching-pending promotion',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports refreshed Manage, Issue action, availability, and Association card regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) => {
        const fileName = String(key);
        if (fileName.includes('ManageSlideOver')) {
          return 'className="w-full" buttonSize="sm" actionButtonSize="default" intl.formatMessage(messages.manageModalMedia)';
        }
        if (
          fileName.endsWith('src/components/IssueDetails/IssueDiscussion.tsx')
        ) {
          return 'buttonSize="default"';
        }
        return '';
      },
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'media management actions must never use a full-width button override',
    'media management actions must not use the ambiguously named small size',
    'the management Cancel action must use the shared standard size',
    'media management must delegate common actions to their shared owner',
    'media management must not retain a standalone Media card heading',
    'the management Cancel action must retain the approved alignment without local spacing',
    'Report an Issue actions must preserve the standard icon-to-label gap',
    'both inline issue actions must use the shared small action size',
    'the ratings row must not add bottom spacing before the primary actions',
    'ratings and primary actions must retain the shared card-spacing gap',
    'availability headings and status icons must share one centered cell style',
    'scrolling media table headers must reserve the shared thin scrollbar width',
    'Series selection must use one shared scroll viewport rather than separate season and episode scrollers',
    'playback selector headers must reserve the same right-side space as their rows',
    'association results must reuse the complete artwork-backed Issue card surface',
    'association detail cards must retain the shared artwork, poster, and scrim block',
    'association results must resolve per-title background artwork through one shared helper',
    'both Issue card detail separators must use the shared owning-column border class',
    'Issue cards must not reserve a standalone divider track between detail groups',
    'the style standard must govern divider ownership independently of page examples',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('shared CSS checks accept grouped selectors but reject unrelated declarations', () => {
  const validate = (css) =>
    validateCurrentBatchContract({
      'src/styles/globals.css': css,
    });
  const reason = 'manage button must turn white on hover';
  assert.ok(
    !validate(
      '.app-button-manage:hover, .detail-disclosure-control:hover { color: #fff; }'
    ).some((error) => error.includes(reason))
  );
  assert.ok(
    validate(
      '.app-button-manage:hover { color: hsl(258 90% 83%); } .unrelated:hover { color: #fff; }'
    ).some((error) => error.includes(reason))
  );
  const spacing =
    'wrapped discovery filter rows must use the shared card spacing';
  assert.ok(
    !validate(
      '.discover-filter-secondary-row, .other { gap: var(--card-spacing); margin-top: var(--card-spacing); }'
    ).some((error) => error.includes(spacing))
  );
  assert.ok(
    validate(
      '.discover-filter-secondary-row { gap: 5px; } .other { gap: var(--card-spacing); margin-top: var(--card-spacing); }'
    ).some((error) => error.includes(spacing))
  );
  assert.ok(
    !validate(
      '/* Shared owner, formatted independently. */\n.discover-filter-secondary-row,\n.other { gap:\nvar(--card-spacing); }\n.discover-filter-secondary-row { margin-top: var(--card-spacing); }'
    ).some((error) => error.includes(spacing))
  );
  assert.ok(
    validate(
      '.discover-filter-secondary-row { gap: var(--card-spacing); } /* .discover-filter-secondary-row { margin-top: var(--card-spacing); } */'
    ).some((error) => error.includes(spacing))
  );
});

test('reports related-media controls, inset-heading, and duplicate icon-gap regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: (_target, key) =>
        String(key).endsWith('src/components/Association/AssociationBadge.tsx')
          ? 'className="ml-1.5"'
          : String(key).endsWith('src/styles/globals.css')
            ? '.media-playback-control-group'
            : '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'movie and series discovery must consume the shared filter and sort controls',
    'linked Recommendations and Similar pages must reuse their media discovery controls',
    'linked Recommendations and Similar pages must apply their visible filters and sorts',
    'media inset and table headings must use their shared mode-aware typography',
    'detail action labels must not duplicate the shared button icon gap',
    'quality selection and ratings must use the compact full-width shared row',
    'rating image and value pairs must use only the shared internal spacing token',
    'playback controls must not be nested in a group that defeats full-row justification',
    'Movie quality selection and ratings must precede playback in the primary action row',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('reports Discover media tabs, compact filters, button shadows, and scoped pin regressions', () => {
  const proxy = new Proxy(
    {},
    {
      has: () => true,
      get: () => '',
    }
  );
  const errors = validateCurrentBatchContract(proxy);

  for (const expected of [
    'Discover media filters must retain the Movies, Series, Music, Books, Audiobooks order',
    'Trending must retain its own five-choice shared media filter row',
    'Trending media choices must render the corresponding complete discovery controls',
    'every Trending media destination must place the shared media filters above its own Filters controls',
    'filter buttons must resolve through the shared action-height token',
    'filter button focus emphasis must render outside the fixed control box',
    'selected filter emphasis must render outside the fixed control box',
    'pinned filter section icons must use the shared dark-blue selected surface',
    'the title visibility filter must consume the shared compact filter button',
    'non-filter buttons must retain the shared ratings-style black readability shadow',
    'filter and sort buttons must remain exempt from the shared action-button shadow',
    'Request List sort direction must retain the shared shadow-free filter owner, accessible help and direction callback inside its pinned sort panel',
    'detail disclosure pins must use the authenticated category-scoped per-user settings endpoint',
    'detail disclosure pin storage must be scoped by media category',
    'each detail page must consume only its own persistent pin category',
  ]) {
    assert.ok(
      errors.some((error) => error.includes(expected)),
      expected
    );
  }
});

test('compact Request geometry checker accepts the shared owner and rejects regressions', () => {
  const cardFile = 'src/components/RequestCard/index.tsx';
  const cssFile = 'src/styles/globals.css';
  const reason =
    'loaded and loading compact Request cards must share CSS geometry without fixed loaded height';
  const card = repositoryFilesWith()[cardFile];
  const css = repositoryFilesWith()[cssFile];
  const fails = (overrides) =>
    validateCurrentBatchContract(repositoryFilesWith(overrides)).some((error) =>
      error.includes(reason)
    );
  assert.equal(fails({}), false, 'current shared compact geometry passes');
  assert.equal(
    fails({
      [cardFile]: card.replaceAll(
        'request-card-compact-layout',
        'request-card-retired-layout'
      ),
    }),
    true,
    'lost shared geometry fails'
  );
  assert.equal(
    fails({
      [cssFile]: css + '\n.request-card-compact-layout { height: 7.5rem; }',
    }),
    true,
    'fixed loaded height fails'
  );
  assert.equal(
    fails({
      [cssFile]: css + '\n.request-card-placeholder { height: 9.5rem; }',
    }),
    true,
    'retired tall placeholder fails'
  );
  assert.equal(
    fails({
      [cardFile]: card.replaceAll(
        'request-card-compact-layout',
        'request-card-compact-layout w-72'
      ),
    }),
    true,
    'duplicate utility owner fails'
  );
});

test('request dropdown portal stacking accepts native CSS and rejects lower or lost owners', () => {
  const cssFile = 'src/styles/globals.css';
  const source = repositoryFilesWith()[cssFile];
  const reason =
    'request dropdown portals must sit above the z-60 modal backdrop';
  const fails = (css) =>
    validateCurrentBatchContract(repositoryFilesWith({ [cssFile]: css })).some(
      (error) => error.includes(reason)
    );
  assert.equal(
    fails(source),
    false,
    'native z-index 100 retains the approved portal stack'
  );
  assert.equal(
    fails(
      source.replace(
        /(\.request-listbox-menu\s*\{[\s\S]*?z-index:)\s*100;/,
        '$1 50;'
      )
    ),
    true,
    'lower portal stack fails'
  );
  assert.equal(
    fails(
      source.replace(
        /(\.request-listbox-menu\s*\{[\s\S]*?)z-index:\s*100;/,
        '$1'
      )
    ),
    true,
    'missing portal stack owner fails'
  );
  assert.equal(
    fails(source + '\n.request-listbox-menu { z-index: 50; }'),
    true,
    'competing lower owner fails'
  );
});

test('native disclosure layout accepts reordered CSS and rejects lost or competing geometry', () => {
  const cssFile = 'src/styles/globals.css';
  const source = repositoryFilesWith()[cssFile];
  const reason =
    'Cast, Crew, and Subject Tags must match the shared segmented action-height surface';
  const fails = (css) =>
    validateCurrentBatchContract(repositoryFilesWith({ [cssFile]: css })).some(
      (error) => error.includes(reason)
    );
  const alter = (modify) => {
    const ast = require('postcss').parse(source);
    ast.walkRules((rule) => {
      if (rule.selectors.includes('.detail-disclosure-control')) modify(rule);
    });
    return ast.toString();
  };
  assert.equal(
    fails(source),
    false,
    'native layout retains its shared action-height owner'
  );
  assert.equal(
    fails(
      alter((rule) => {
        const nodes = [...rule.nodes];
        rule.removeAll();
        for (const node of nodes.reverse()) rule.append(node);
      })
    ),
    false,
    'declaration ordering is not part of the native layout contract'
  );
  for (const property of [
    'display',
    'align-items',
    'overflow',
    'border-radius',
    'border-width',
    'border-style',
    'height',
    'min-height',
    'max-height',
  ])
    assert.equal(
      fails(alter((rule) => rule.walkDecls(property, (decl) => decl.remove()))),
      true,
      `lost ${property} owner fails`
    );
  assert.equal(
    fails(source + '\n.detail-disclosure-control { height: 20px; }'),
    true,
    'competing fixed control height fails'
  );
  assert.equal(
    fails(source + '\n.detail-disclosure-control { border: 0; }'),
    true,
    'competing border shorthand fails'
  );
  assert.equal(
    fails(source + '\n.detail-disclosure-control { border-radius: 0.5rem; }'),
    true,
    'competing corner geometry fails'
  );
});

test('pinned filter ownership accepts section descriptors and rejects missing, duplicate or empty panels', () => {
  const reason =
    'filter categories must retain distinct labeled pinned sections and rendered content';
  const consumers = [
    'src/components/Discover/MediaDiscoveryControls.tsx',
    'src/components/Discover/DiscoverMusic/index.tsx',
    'src/components/Blocklist/index.tsx',
    'src/components/IssueList/index.tsx',
    'src/components/RequestList/index.tsx',
    'src/components/Search/index.tsx',
    'src/components/Discover/DiscoverBooks/index.tsx',
    'src/components/Requests/index.tsx',
  ];
  const baseline = validateCurrentBatchContract(repositoryFilesWith());
  for (const fileName of consumers) {
    const source = repositoryFilesWith()[fileName];
    assert.equal(
      baseline.some(
        (error) => error.startsWith(`${fileName}:`) && error.includes(reason)
      ),
      false,
      fileName
    );
    const changed = source.replaceAll(
      'PinnedFilterSection',
      'RetiredFilterSection'
    );
    assert.notEqual(changed, source, 'current pinned role exists');
    assert.ok(
      validateCurrentBatchContract(
        repositoryFilesWith({ [fileName]: changed })
      ).some(
        (error) => error.startsWith(`${fileName}:`) && error.includes(reason)
      ),
      `${fileName}: detached pinned owner fails`
    );
  }
  const fileName = consumers[0];
  const source = repositoryFilesWith()[fileName];
  const fails = (changed) =>
    validateCurrentBatchContract(
      repositoryFilesWith({ [fileName]: changed })
    ).some(
      (error) => error.startsWith(`${fileName}:`) && error.includes(reason)
    );
  assert.equal(
    fails(source.replace("section: 'sortBy'", "section: 'filters'")),
    true,
    'duplicate sections fail'
  );
  assert.equal(
    fails(source.replace("section: 'filters'", "section: 'retiredFilters'")),
    true,
    'missing required section fails'
  );
  assert.equal(
    fails(
      source.replace(
        'children: <FilterPanel type={type} currentFilters={currentFilters} />',
        'children: undefined'
      )
    ),
    true,
    'empty grouped panel fails'
  );
  assert.equal(
    fails(source.replace('mediaType={type}', '')),
    true,
    'missing pin context fails'
  );
  const standalone = 'src/components/Search/index.tsx';
  const ast = require('typescript').createSourceFile(
    'Search.tsx',
    repositoryFilesWith()[standalone],
    require('typescript').ScriptTarget.Latest,
    true,
    require('typescript').ScriptKind.TSX
  );
  let bounds;
  const findPanel = (node) => {
    if (
      !bounds &&
      require('typescript').isJsxElement(node) &&
      node.openingElement.tagName.getText(ast) === 'PinnedFilterSection'
    )
      bounds = [node.openingElement.end, node.closingElement.pos];
    require('typescript').forEachChild(node, findPanel);
  };
  findPanel(ast);
  assert.ok(bounds, 'standalone pinned panel exists');
  const text = repositoryFilesWith()[standalone];
  assert.ok(
    validateCurrentBatchContract(
      repositoryFilesWith({
        [standalone]: text.slice(0, bounds[0]) + text.slice(bounds[1]),
      })
    ).some(
      (error) => error.startsWith(`${standalone}:`) && error.includes(reason)
    ),
    'empty standalone panel fails'
  );
});

test('native filter geometry accepts grouped and reordered CSS but rejects lost or competing owners', () => {
  const fileName = 'src/styles/globals.css';
  const source = repositoryFilesWith()[fileName];
  const reason =
    'native filter geometry must retain shared segmented spacing, wrapping, narrow bounds and pinned panel boundaries';
  const fails = (css) =>
    validateCurrentBatchContract(repositoryFilesWith({ [fileName]: css })).some(
      (error) => error.includes(reason)
    );
  const alter = (selector, change) => {
    const ast = require('postcss').parse(source);
    ast.walkRules((rule) => {
      if (rule.selectors.includes(selector)) change(rule);
    });
    return ast.toString();
  };
  assert.equal(fails(source), false);
  assert.equal(
    fails(
      alter('.app-filter-segment-focus', (rule) => {
        rule.selector += ', .another-segment';
        const nodes = [...rule.nodes];
        rule.removeAll();
        for (const node of nodes.reverse()) rule.append(node);
      })
    ),
    false,
    'selector grouping and declaration order are not the contract'
  );
  for (const [selector, property] of [
    ['.app-filter-segment-focus', 'padding-inline'],
    ['.app-filter-segment-focus', 'column-gap'],
    ['.app-filter-search-control', 'max-width'],
    ['.app-filter-row', 'flex-wrap'],
    ['.app-pinned-filter-section', 'margin-bottom'],
    ['.app-pinned-filter-panel', 'margin-top'],
  ])
    assert.equal(
      fails(
        alter(selector, (rule) =>
          rule.walkDecls(property, (decl) => decl.remove())
        )
      ),
      true,
      `lost ${selector} ${property} fails`
    );
  for (const competing of [
    '.app-filter-segment-focus { padding-inline: 8px; }',
    '.app-filter-segment-focus { padding: 0; }',
    '.app-filter-segment-focus { @apply px-2; }',
    '.app-filter-button > button { padding-inline: 8px; }',
    '.app-filter-search-control { max-width: none; }',
    '.app-filter-row { flex-wrap: nowrap; }',
    '.app-pinned-filter-section { margin: 0; }',
  ])
    assert.equal(
      fails(`${source}\n${competing}`),
      true,
      `competing owner fails: ${competing}`
    );
});

test('music and legacy request filters retain rendered control order and current direction ownership', () => {
  const musicFile = 'src/components/Discover/DiscoverMusic/index.tsx';
  const music = repositoryFilesWith()[musicFile];
  const musicReason =
    'Music filters must preserve their effective control order inside the shared wrapping pinned panel';
  const directionFile = 'src/components/RequestList/index.tsx';
  const direction = repositoryFilesWith()[directionFile];
  const directionReason =
    'Request List sort direction must retain the shared shadow-free filter owner, accessible help and direction callback inside its pinned sort panel';
  const fails = (fileName, source, reason) =>
    validateCurrentBatchContract(
      repositoryFilesWith({ [fileName]: source })
    ).some((error) => error.includes(reason));
  assert.equal(fails(musicFile, music, musicReason), false);
  assert.equal(fails(directionFile, direction, directionReason), false);
  assert.equal(
    fails(
      musicFile,
      music
        .replace('<MusicArtistFilter />', '')
        .replace('</form>', '</form><MusicArtistFilter />'),
      musicReason
    ),
    true,
    'moving artist after keyword fails'
  );
  assert.equal(
    fails(
      musicFile,
      music.replace(
        'className="app-filter-row"',
        'className="flex flex-wrap gap-2"'
      ),
      musicReason
    ),
    true,
    'utility-owned row fails'
  );
  assert.equal(
    fails(
      musicFile,
      music.replace('messages.releaseYear)}', 'messages.genres)}'),
      musicReason
    ),
    true,
    'replacing year control with another genre control fails'
  );
  assert.equal(
    fails(
      directionFile,
      direction.replace(
        'getFilterToggleButtonClass(false)',
        'getFilterToggleButtonClass(true)'
      ),
      directionReason
    ),
    true,
    'untruthful active direction variant fails'
  );
  assert.equal(
    fails(
      directionFile,
      direction.replace(
        /setCurrentSortDirection\(\s*currentSortDirection ===/,
        'retiredSortDirection(currentSortDirection ==='
      ),
      directionReason
    ),
    true,
    'lost direction callback fails'
  );
  assert.equal(
    fails(
      directionFile,
      direction.replaceAll('Tooltip', 'RetiredHelp'),
      directionReason
    ),
    true,
    'lost direction help fails'
  );
  assert.equal(
    fails(
      directionFile,
      direction.replace(
        'className={getFilterToggleButtonClass(false)}',
        'className="app-control-shadow-exempt z-40 mr-2 rounded-l-none px-3"'
      ),
      directionReason
    ),
    true,
    'retired utility style is not the current filter owner'
  );
});
