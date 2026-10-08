import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';
import ts from 'typescript';
import { auditTailwindClassExpressions } from './tailwindClassVerifier.mjs';

const component = (path) =>
  readFileSync(new URL(`../components/${path}`, import.meta.url), 'utf8');

test('catalog browsing and filter controls use shared semantic presentation owners', () => {
  for (const path of [
    'Discover/DiscoverTv/index.tsx',
    'Discover/MediaDiscoveryControls.tsx',
    'Discover/FilterPanel/index.tsx',
    'Discover/FilterPanel/CompactFilterSelect.tsx',
    'Common/ListView/index.tsx',
    'Selector/index.tsx',
  ]) {
    const report = auditTailwindClassExpressions({
      path,
      source: component(path),
    });
    assert.deepEqual(report.utilities, [], path);
  }
});

test('software catalog ownership and play-time use shared visual roles', () => {
  const source = component('SoftwareCatalog/index.tsx');
  assert.match(
    source,
    /className="software-catalog-library-badge media-type-badge media-type-badge-compact"/
  );
  assert.match(source, /data-presentation="poster"/);
  assert.match(source, /data-presentation="inline"/);
  assert.match(source, /game\.steamOwned &&/);
  assert.match(source, /selectedGame\.steamOwned &&/);
  assert.match(source, /className="app-card-inset refreshed-inset-surface"/);
  assert.match(source, /className="card-table detail-paired-columns"/);
  assert.match(
    source,
    /className="software-catalog-playtime-value card-table-value card-spacing-before"/
  );
  assert.match(source, /messages\.quickFinish/);
  assert.match(source, /messages\.mainStoryLabel/);
  assert.match(source, /messages\.completionist/);

  const css = postcss.parse(
    readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
  );
  let badge;
  let posterBadge;
  let playtimeValue;
  css.walkRules((rule) => {
    if (rule.selector === '.software-catalog-library-badge') badge = rule;
    if (
      rule.selector ===
      ".software-catalog-library-badge[data-presentation='poster']"
    ) {
      posterBadge = rule;
    }
    if (rule.selector === '.software-catalog-playtime-value')
      playtimeValue = rule;
  });
  assert.ok(badge, 'the catalog ownership badge has a shared CSS owner');
  assert.deepEqual(
    badge.nodes.filter((node) => node.type === 'decl').map((node) => node.prop),
    ['border-color', 'background-color', 'color']
  );
  assert.match(badge.toString(), /var\(--palette-blue(?:-dark|-light)?\)/);
  assert.ok(posterBadge, 'poster placement is owned by the CSS role');
  assert.deepEqual(
    posterBadge.nodes
      .filter((node) => node.type === 'decl')
      .map((node) => node.prop),
    ['position', 'z-index', 'inset-inline-end', 'inset-block-end']
  );
  assert.match(posterBadge.toString(), /var\(--card-spacing\)/);
  assert.ok(playtimeValue, 'play-time contrast is owned by the CSS role');
  assert.equal(
    playtimeValue.nodes.find((node) => node.type === 'decl')?.prop,
    'color'
  );
  assert.match(playtimeValue.toString(), /var\(--color-gray-300\)/);
});

test('compact region controls contain no utilities without certifying other form variants', () => {
  const path = 'RegionSelector/index.tsx';
  const source = ts.createSourceFile(
    path,
    component(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const result = ts.transform(source, [
    (context) => {
      const visitor = (node) => {
        if (
          ts.isConditionalExpression(node) &&
          ts.isIdentifier(node.condition) &&
          node.condition.text === 'compact'
        ) {
          return ts.visitNode(node.whenTrue, visitor);
        }
        return ts.visitEachChild(node, visitor, context);
      };
      return (node) => ts.visitNode(node, visitor);
    },
  ]);
  try {
    const compactSource = ts.createPrinter().printFile(result.transformed[0]);
    const report = auditTailwindClassExpressions({
      path,
      source: compactSource,
    });
    assert.deepEqual(report.utilities, []);
    for (const helper of ['optionClass', 'valueClass']) {
      const initializer = compactSource.match(
        new RegExp(`const ${helper} =[^;]+;`)
      )?.[0];
      assert.ok(initializer, helper);
      assert.doesNotMatch(initializer, /(?:text-|font-|bg-|p[rl]-|truncate)/);
    }
    assert.match(
      compactSource,
      /flag:/,
      'country flags retain their external icon family'
    );
    assert.match(compactSource, /app-filter-select-menu/);
    assert.doesNotMatch(compactSource, /leave="transition/);
  } finally {
    result.dispose();
  }
});

test('active filter and poster control owners are native and retain semantic geometry', () => {
  const css = postcss.parse(
    readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
  );
  const active =
    /^\.(?:app-button(?:-default)?$|poster-control$|app-filter-(?:button|count|search-input|select-|rating-option|section-)|discover-filter-(?:primary-row$|secondary-row$|control(?:$|-label|\.compact-select-warning))|availability-quality-|media-rating-)/;
  css.walkAtRules('apply', (node) => {
    assert.ok(!active.test(node.parent.selector ?? ''), node.parent.selector);
  });
  for (const selector of [
    '.app-button',
    '.poster-control',
    '.app-filter-button',
    '.discover-filter-control',
  ]) {
    let owner;
    css.walkRules((rule) => {
      if (rule.selector === selector) owner = rule;
    });
    assert.ok(owner, selector);
    const declarations = owner.nodes.filter((node) => node.type === 'decl');
    const properties = declarations.map((node) => node.prop);
    assert.equal(
      new Set(properties).size,
      properties.length,
      `${selector}: duplicate declarations`
    );
    assert.ok(
      !properties.some((property) => property.startsWith('--tw-')),
      selector
    );
    assert.equal(
      declarations.find((node) => node.prop === 'border-radius')?.value,
      'var(--control-corner-radius)'
    );
  }
});

test('compact provider fetching reports page activity and actions retain source behavior', () => {
  const source = component('Selector/index.tsx');
  assert.match(
    source,
    /useSearchActivityReporter\([\s\S]*?Boolean\(regionLabel\) && isLoading/
  );
  assert.match(source, /regionLabel \? null :\s*\(?\s*<SmallLoadingSpinner/);
  assert.match(source, /data-selected=\{isActive\}/);
  assert.match(source, /<Button[\s\S]*?data-provider-region="expand-control"/);
  assert.match(source, /onClick=\{\(\) => toggleProvider\(provider.id\)\}/);
  const page = component('Discover/DiscoverTv/index.tsx');
  assert.match(page, /<PageErrorMessage/);
  assert.match(page, /onClick: \(\) => discover.mutate\?\.\(\)/);
  assert.doesNotMatch(page, /@app\/pages\/_error/);
});

const parseConsumer = (source) =>
  ts.createSourceFile(
    'consumer.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
const collectNodes = (node, predicate) => {
  const matches = [];
  const visit = (child) => {
    if (predicate(child)) matches.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return matches;
};
const consumerOpenings = (source) =>
  collectNodes(
    parseConsumer(source),
    (node) => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
  );
const consumerAttribute = (node, name) =>
  node.attributes.properties.find(
    (attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === name
  );
const consumerValue = (node, name) => {
  const initializer = consumerAttribute(node, name)?.initializer;
  return (
    initializer &&
    (ts.isJsxExpression(initializer)
      ? initializer.expression?.getText()
      : initializer.text)
  );
};
const verifyScopedFilterOwners = (source) => {
  const tree = parseConsumer(source);
  const scopes = collectNodes(tree, (node) => {
    if (!ts.isJsxElement(node)) return false;
    const opening = node.openingElement;
    return (
      /^(?:PinnedFilterSection|PinnedFilterSectionGroup)$/.test(
        opening.tagName.getText()
      ) ||
      consumerValue(opening, 'className')
        ?.split(/\s+/)
        .includes('app-filter-row')
    );
  });
  assert.ok(scopes.length, 'the audited filter scope must exist');
  for (const scope of scopes) {
    const report = auditTailwindClassExpressions({
      path: 'scoped-filter.tsx',
      source: scope.getText(),
    });
    assert.deepEqual(
      report.utilities,
      [],
      'filter consumers must not restore presentation utilities'
    );
    for (const opening of consumerOpenings(scope.getText())) {
      assert.equal(
        consumerAttribute(opening, 'style'),
        undefined,
        'filter consumers must not restore inline presentation'
      );
    }
  }
};
const verifyPinnedGroup = (source, expectedSections) => {
  const groups = consumerOpenings(source).filter(
    (node) => node.tagName.getText() === 'PinnedFilterSectionGroup'
  );
  assert.equal(groups.length, 1, 'the page retains one shared pinnable group');
  assert.ok(
    consumerAttribute(groups[0], 'mediaType'),
    'the existing media pin context remains bound'
  );
  const attribute = consumerAttribute(groups[0], 'sections');
  assert.ok(attribute, 'pinned sections remain bound');
  const sections = collectNodes(
    attribute,
    (node) => ts.isPropertyAssignment(node) && node.name.getText() === 'section'
  ).map((node) => node.initializer.text);
  assert.deepEqual(
    sections,
    expectedSections,
    'section identities and order must be preserved'
  );
  for (const item of collectNodes(
    attribute,
    (node) =>
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText() === 'section'
      )
  )) {
    for (const name of ['label', 'children'])
      assert.ok(
        item.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            property.name.getText() === name
        ),
        'each disclosure keeps its label and real controls'
      );
  }
};
const verifyPermanentTitleBranches = (source) => {
  const openings = consumerOpenings(source);
  assert.ok(
    openings.some(
      (node) =>
        /^(?:h1|h2)$/.test(node.tagName.getText()) &&
        consumerValue(node, 'className') === 'page-title'
    ),
    'visible title typography consumes the shared owner'
  );
  assert.ok(
    openings.some(
      (node) => consumerValue(node, 'className') === 'page-title-row'
    ),
    'title arrangement consumes the shared row'
  );
  for (const branch of collectNodes(
    parseConsumer(source),
    ts.isReturnStatement
  )) {
    const text = branch.expression?.getText() ?? '';
    if (/<(?:LoadingSpinner|ErrorPage)\b/.test(text))
      assert.match(
        text,
        /pendingHeading|page-title/,
        'loading and failure returns retain their visible page identity'
      );
  }
};
const unwrapOptions = (expression) => {
  if (ts.isJsxExpression(expression))
    return unwrapOptions(expression.expression);
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression))
    return unwrapOptions(expression.expression);
  if (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'map'
  )
    return unwrapOptions(expression.expression.expression);
  assert.ok(
    ts.isArrayLiteralExpression(expression),
    'dropdown options remain source-backed'
  );
  return expression.elements.map((item) =>
    ts.isArrayLiteralExpression(item)
      ? item.elements[0].text
      : item.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) &&
            property.name.getText() === 'value'
        ).initializer.text
  );
};
const verifyLegacyRequestControls = (source) => {
  const controls = consumerOpenings(source).filter(
    (node) => node.tagName.getText() === 'CompactSelect'
  );
  assert.equal(
    controls.length,
    3,
    'status, media and sort controls remain separate'
  );
  for (const [index, value, options, setter] of [
    [
      0,
      'effectiveFilter',
      [
        'all',
        'pending',
        'approved',
        'completed',
        'processing',
        'failed',
        'available',
        'unavailable',
        'deleted',
      ],
      'setCurrentFilter',
    ],
    [
      1,
      'effectiveMediaType',
      ['all', 'movie', 'tv', 'music', 'book', 'sports'],
      'setCurrentMediaType',
    ],
    [2, 'currentSort', ['added', 'modified'], 'setCurrentSort'],
  ]) {
    assert.equal(
      consumerValue(controls[index], 'value'),
      value,
      'selected state binding must be retained'
    );
    assert.deepEqual(
      unwrapOptions(consumerAttribute(controls[index], 'options').initializer),
      options,
      'existing options and their order must be retained'
    );
    const change = consumerValue(controls[index], 'onChange');
    assert.ok(
      change?.includes(setter),
      'selection keeps the existing state setter'
    );
    assert.match(
      change,
      /router\.push\(/,
      'selection keeps its existing navigation callback'
    );
    assert.match(
      change,
      /userId:\s*router\.query\.userId/,
      'targeted-user navigation is retained'
    );
  }
  assert.equal(
    consumerValue(controls[0], 'defaultValue'),
    'pending',
    'legacy pending default remains explicit'
  );
  assert.match(
    source,
    /setCurrentSortDirection\(\s*currentSortDirection === 'asc' \? 'desc' : 'asc'/,
    'sort direction keeps its original toggle semantics'
  );
};

test('assigned filter consumers retain semantic row and control owners without auditing content cards', () => {
  for (const path of [
    'Search/index.tsx',
    'Association/AssociationFilters.tsx',
    'Blocklist/index.tsx',
    'IssueList/index.tsx',
    'UserList/index.tsx',
    'RequestList/index.tsx',
    'Discover/MediaDiscoveryControls.tsx',
  ])
    verifyScopedFilterOwners(component(path));
  const keyword = component('Search/ContextualSearchFilters.tsx');
  assert.match(keyword, /discover-filter-control app-filter-search-control/);
  assert.match(keyword, /className="app-filter-search-input"/);
  assert.match(keyword, /onSearchSubmit\(\)/);
  assert.match(
    keyword,
    /onChange=\{\(event\) => setSearch\(event\.target\.value\)\}/
  );
});
test('task catalog sections and discovery filters use supported shared pinnable identities', () => {
  for (const path of ['Blocklist/index.tsx', 'IssueList/index.tsx'])
    verifyPinnedGroup(component(path), [
      'taskFilters',
      'mediaFilters',
      'filters',
      'sortBy',
    ]);
  verifyPinnedGroup(component('RequestList/index.tsx'), [
    'taskFilters',
    'mediaFilters',
    'sortBy',
  ]);
  verifyPinnedGroup(component('Discover/MediaDiscoveryControls.tsx'), [
    'filters',
    'sortBy',
  ]);
  assert.doesNotMatch(
    component('UserList/index.tsx'),
    /<PinnedFilterSection(?:Group)?\b/,
    'neutral user pages must not borrow an unrelated media pin context'
  );
});
test('assigned pending and failed page branches retain permanent shared title owners', () => {
  for (const path of [
    'Association/index.tsx',
    'Blocklist/index.tsx',
    'IssueList/index.tsx',
    'UserList/index.tsx',
    'RequestList/index.tsx',
  ])
    verifyPermanentTitleBranches(component(path));
  assert.match(
    component('Search/index.tsx'),
    /<Header\b/,
    'Search keeps the shared permanent title component'
  );
});
test('legacy profile request controls preserve selected state, options and targeted-user callbacks', () =>
  verifyLegacyRequestControls(component('RequestList/index.tsx')));
test('consumer guards reject utilities, lost pin sections, missing titles and lost callbacks', () => {
  const blocklist = component('Blocklist/index.tsx');
  assert.throws(
    () =>
      verifyScopedFilterOwners(
        blocklist.replace(
          'className="app-filter-row"',
          'className="app-filter-row px-4"'
        )
      ),
    /presentation utilities/
  );
  assert.throws(
    () =>
      verifyPinnedGroup(
        blocklist.replace("section: 'taskFilters'", "section: 'unknown'"),
        ['taskFilters', 'mediaFilters', 'filters', 'sortBy']
      ),
    /identities and order/
  );
  assert.throws(
    () =>
      verifyPermanentTitleBranches(
        component('Association/index.tsx').replaceAll(
          'className="page-title"',
          'className="text-2xl"'
        )
      ),
    /shared owner/
  );
  const requests = component('RequestList/index.tsx');
  const first = consumerOpenings(requests).find(
    (node) => node.tagName.getText() === 'CompactSelect'
  );
  assert.throws(
    () =>
      verifyLegacyRequestControls(
        requests.replace(consumerAttribute(first, 'onChange').getText(), '')
      ),
    /state setter/
  );
});
