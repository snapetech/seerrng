import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const parse = (path) =>
  ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
const nodes = (root, predicate) => {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
};
const attribute = (opening, name) =>
  opening.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.getText() === name
  );
const expression = (opening, name) =>
  attribute(opening, name)?.initializer?.expression;
const ancestor = (node, predicate) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (predicate(parent)) return parent;
  }
  return undefined;
};

test('blocked poster visibility follows management permission on filtering and rendering paths', () => {
  const card = parse('../components/TitleCard/index.tsx');
  const list = parse('../components/Common/ListView/index.tsx');
  const discover = parse('../hooks/useDiscover.ts');
  const statuses = { BLOCKLISTED: 'blocked', AVAILABLE: 'available' };
  const evaluate = (node, bindings) => {
    const javascript = ts.transpileModule(
      `const expressionValue = (${node.getText()});`,
      {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
      }
    ).outputText;
    return new Function(
      ...Object.keys(bindings),
      `${javascript}\nreturn expressionValue;`
    )(...Object.values(bindings));
  };
  for (const source of [card, list, discover]) {
    const permission = nodes(
      source,
      (node) =>
        ts.isVariableDeclaration(node) &&
        node.name.getText() === 'canManageBlocklist'
    );
    assert.equal(permission.length, 1);
    assert.equal(
      permission[0].initializer.getText(),
      'hasPermission(Permission.MANAGE_BLOCKLIST)'
    );
  }
  const visible = nodes(
    list,
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText() === 'visibleItems'
  )[0];
  const listFilter = nodes(
    visible,
    (node) =>
      ts.isCallExpression(node) && node.expression.getText().endsWith('.filter')
  )[0].arguments[0];
  const discoverGate = nodes(
    discover,
    (node) =>
      ts.isIfStatement(node) &&
      node.expression.getText().includes('hideBlocklisted') &&
      node.expression.getText().includes('canManageBlocklist') &&
      node.expression
        .getText()
        .includes('settings.currentSettings.hideBlocklisted')
  )[0];
  assert.ok(discoverGate);
  const renderGate = nodes(
    card,
    (node) =>
      ts.isIfStatement(node) &&
      node.expression.getText() ===
        'currentStatus === MediaStatus.BLOCKLISTED && !canManageBlocklist'
  )[0];
  assert.ok(renderGate);
  for (const canManageBlocklist of [false, true]) {
    for (const hidePreference of [false, true]) {
      const filter = evaluate(listFilter, {
        canManageBlocklist,
        currentSettings: { hideBlocklisted: hidePreference },
        MediaStatus: statuses,
      });
      assert.equal(
        filter({ mediaInfo: { status: statuses.BLOCKLISTED } }),
        canManageBlocklist && !hidePreference
      );
      assert.equal(filter({ mediaInfo: { status: statuses.AVAILABLE } }), true);
      assert.equal(filter({}), true);
    }
    assert.equal(
      evaluate(renderGate.expression, {
        currentStatus: statuses.BLOCKLISTED,
        canManageBlocklist,
        MediaStatus: statuses,
      }),
      !canManageBlocklist
    );
  }
  // Managers bypass the default hide, but the explicit user preference still applies.
  for (const hideBlocklisted of [false, true]) {
    for (const canManageBlocklist of [false, true]) {
      for (const hidePreference of [false, true]) {
        assert.equal(
          evaluate(discoverGate.expression, {
            hideBlocklisted,
            canManageBlocklist,
            settings: { currentSettings: { hideBlocklisted: hidePreference } },
          }),
          hideBlocklisted && (!canManageBlocklist || hidePreference)
        );
      }
    }
  }
  assert.doesNotMatch(card.getText(), /wasBlocklistedHere/);
  const removeHandler = nodes(
    card,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText() === 'onClickShowBlocklistBtn'
  )[0];
  for (const setter of ['setCurrentStatus', 'setCurrentStatus4k']) {
    const updates = nodes(
      removeHandler,
      (node) =>
        ts.isCallExpression(node) && node.expression.getText() === setter
    );
    assert.equal(updates.length, 2);
    assert.ok(
      updates.every(
        (update) => update.arguments[0].getText() === 'MediaStatus.UNKNOWN'
      )
    );
  }
  for (const source of [list, discover]) {
    const dependencyArrays = nodes(source, ts.isArrayLiteralExpression);
    assert.ok(
      dependencyArrays.some((array) =>
        array.elements.some(
          (element) => element.getText() === 'canManageBlocklist'
        )
      )
    );
  }
});

test('Blocklist states share one permission-gated poster control with descriptive help', () => {
  const card = parse('../components/TitleCard/index.tsx');
  const association = parse('../components/Association/AssociationBadge.tsx');
  const buttons = nodes(
    card,
    (node) =>
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText() === 'button' &&
      attribute(node, 'className')
        ?.initializer?.text?.split(/\s+/)
        .includes('poster-control-blocklist')
  );
  assert.equal(buttons.length, 1);
  const button = buttons[0];
  assert.deepEqual(
    attribute(button, 'className').initializer.text.split(/\s+/),
    ['poster-control', 'poster-control-blocklist', 'app-control-shadow-exempt']
  );
  const owner = ancestor(
    button,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText() === 'blocklistControl'
  );
  assert.ok(owner);
  assert.ok(ts.isBinaryExpression(owner.initializer));
  assert.equal(owner.initializer.left.getText(), 'showHideButton');
  assert.equal(expression(button, 'disabled')?.getText(), 'isUpdating');
  assert.equal(expression(button, 'aria-pressed')?.getText(), 'isBlocklisted');
  const handler = expression(button, 'onClick');
  assert.deepEqual(
    nodes(handler, ts.isCallExpression).map((node) =>
      node.expression.getText()
    ),
    [
      'event.preventDefault',
      'event.stopPropagation',
      'onClickShowBlocklistBtn',
      'setShowBlocklistModal',
    ]
  );
  assert.match(handler.getText(), /if \(isUpdating\) return/);
  const icons = nodes(button.parent, (node) =>
    ts.isJsxSelfClosingElement(node)
  ).map((node) => node.tagName.getText());
  assert.deepEqual(icons, ['EyeIcon', 'EyeSlashIcon']);
  const help = ancestor(
    button,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText() === 'Tooltip'
  );
  assert.ok(help);
  assert.match(
    expression(help.openingElement, 'content').getText(),
    /blocklistUpdatingDescription[\s\S]*blocklistRemoveDescription[\s\S]*blocklistAddDescription/
  );
  const associationHelp = nodes(
    association,
    (node) =>
      ts.isJsxOpeningElement(node) && node.tagName.getText() === 'Tooltip'
  );
  assert.equal(associationHelp.length, 1);
  assert.match(
    expression(associationHelp[0], 'content').getText(),
    /associationsDescription/
  );
  assert.match(
    read('../components/Common/ListView/index.tsx'),
    /mediaInfo\?\.status !== MediaStatus\.BLOCKLISTED/
  );
});

test('poster watched control retains its row while Blocklist sits below Associations', () => {
  const card = parse('../components/TitleCard/index.tsx');
  const watched = nodes(
    card,
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText() === 'watchedControl'
  );
  assert.equal(watched.length, 1);
  assert.match(
    watched[0].initializer.getText(),
    /watchedStatus\.watchedCount > 0/
  );
  const badges = nodes(
    watched[0],
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText() === 'WatchedBadge'
  );
  assert.equal(badges.length, 1);
  assert.equal(expression(badges[0], 'status')?.getText(), 'watchedStatus');

  const uses = nodes(
    card,
    (node) =>
      ts.isJsxExpression(node) &&
      node.expression?.getText() === 'watchedControl'
  );
  assert.equal(uses.length, 2);
  const previewUse = uses.find((use) =>
    ancestor(
      use,
      (node) =>
        ts.isBinaryExpression(node) &&
        node.left.getText() === 'watchlistPreview'
    )
  );
  assert.ok(previewUse);
  const sharedRow = ancestor(
    previewUse,
    (node) =>
      ts.isJsxElement(node) &&
      attribute(node.openingElement, 'data-poster-region')?.initializer
        ?.text === 'control-row'
  );
  assert.ok(sharedRow);
  assert.ok(
    nodes(
      sharedRow,
      (node) =>
        ts.isJsxExpression(node) &&
        node.expression?.getText() === 'associationControls'
    ).length === 1
  );
  assert.ok(
    ancestor(
      sharedRow,
      (node) =>
        ts.isBinaryExpression(node) &&
        node.left.getText() === 'watchlistPreview'
    )
  );
  const placements = nodes(
    card,
    (node) =>
      ts.isConditionalExpression(node) &&
      node.condition.getText() === 'watchlistPreview' &&
      node.whenTrue.getText().includes('blocklistControl')
  );
  assert.equal(placements.length, 1);
  assert.match(
    placements[0].whenFalse.getText(),
    /blocklistControl[\s\S]*watchedControl/
  );
  const stackedAssociation = nodes(
    card,
    (node) => ts.isJsxExpression(node) && node.expression === placements[0]
  );
  assert.equal(stackedAssociation.length, 1);
  assert.ok(sharedRow.getStart() < stackedAssociation[0].getStart());
});

test('Series Watchlist visual prototype is isolated from production actions and reuses poster effects', () => {
  const card = parse('../components/TitleCard/index.tsx');
  const list = parse('../components/Common/ListView/index.tsx');
  const page = parse('../components/Discover/DiscoverTv/index.tsx');
  for (const source of [card, page]) {
    const visibleCopy = nodes(
      source,
      (node) =>
        ts.isPropertyAssignment(node) &&
        /watchlist.*preview|preview.*watchlist/i.test(node.name.getText()) &&
        ts.isStringLiteral(node.initializer)
    );
    assert.ok(visibleCopy.length > 0);
    for (const message of visibleCopy) {
      assert.doesNotMatch(
        message.initializer.text,
        /\b(?:preview|test(?:ing)?|example)\b/i,
        'visible review surfaces use production-facing copy'
      );
    }
  }
  const css = read('./globals.css');
  const preview = nodes(
    card,
    (node) =>
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText() === 'button' &&
      attribute(node, 'className')
        ?.initializer?.text?.split(/\s+/)
        .includes('poster-control-watchlist')
  );
  assert.equal(
    preview.length,
    1,
    'one preview action uses the shared poster role'
  );
  const button = preview[0];
  assert.ok(
    attribute(button, 'className')
      .initializer.text.split(/\s+/)
      .includes('poster-control-icon')
  );
  assert.match(
    expression(button, 'aria-label')?.getText() ?? '',
    /watchlistPreviewLabel/
  );
  assert.equal(
    button.parent.children.filter(
      (node) => ts.isJsxText(node) && node.getText().trim()
    ).length,
    0
  );
  const renderedExpressions = button.parent.children.filter(ts.isJsxExpression);
  assert.equal(renderedExpressions.length, 1);
  assert.ok(ts.isConditionalExpression(renderedExpressions[0].expression));
  assert.equal(
    renderedExpressions[0].expression.condition.getText(),
    'previewWatchlisted'
  );
  assert.ok(
    attribute(button, 'className')
      .initializer.text.split(/\s+/)
      .includes('poster-control')
  );
  const handler = expression(button, 'onClick');
  assert.ok(handler && ts.isArrowFunction(handler));
  const calls = nodes(handler, ts.isCallExpression).map((node) =>
    node.expression.getText()
  );
  assert.deepEqual(calls, [
    'event.preventDefault',
    'event.stopPropagation',
    'setPreviewWatchlisted',
  ]);
  assert.equal(
    expression(button, 'aria-pressed')?.getText(),
    'previewWatchlisted'
  );
  assert.equal(
    expression(button, 'disabled')?.getText(),
    'watchlistPreviewDisabled'
  );
  assert.ok(
    nodes(
      handler,
      (node) =>
        ts.isIfStatement(node) &&
        node.expression.getText() === 'watchlistPreviewDisabled' &&
        ts.isReturnStatement(node.thenStatement)
    ).length === 1
  );
  const setter = nodes(
    handler,
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText() === 'setPreviewWatchlisted'
  )[0];
  assert.equal(setter.arguments.length, 1);
  assert.ok(ts.isArrowFunction(setter.arguments[0]));
  assert.ok(ts.isPrefixUnaryExpression(setter.arguments[0].body));
  assert.equal(
    setter.arguments[0].body.operator,
    ts.SyntaxKind.ExclamationToken
  );
  assert.equal(
    setter.arguments[0].body.operand.getText(),
    setter.arguments[0].parameters[0].name.getText()
  );
  const state = nodes(
    card,
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements[1]?.name?.getText() === 'setPreviewWatchlisted'
  );
  assert.equal(state.length, 1);
  assert.equal(state[0].initializer.expression.getText(), 'useState');
  assert.equal(
    state[0].initializer.arguments[0].kind,
    ts.SyntaxKind.FalseKeyword
  );
  assert.equal(
    expression(button, 'onKeyDown')?.body?.expression?.getText(),
    'event.stopPropagation'
  );

  const slot = ancestor(
    button,
    (node) =>
      ts.isJsxElement(node) &&
      attribute(node.openingElement, 'data-poster-region')?.initializer
        ?.text === 'watchlist-slot'
  );
  assert.ok(
    slot,
    'the wrapper hosts the tooltip even when its button is disabled'
  );
  const frame = ancestor(
    slot,
    (node) =>
      ts.isJsxElement(node) &&
      attribute(node.openingElement, 'data-poster-region')?.initializer
        ?.text === 'frame'
  );
  assert.ok(frame);
  const frameHandler = expression(frame.openingElement, 'onClick');
  assert.ok(
    nodes(
      frameHandler,
      (node) =>
        ts.isIfStatement(node) &&
        node.expression.getText().includes('closest') &&
        node.expression.getText().includes('watchlist-slot') &&
        ts.isReturnStatement(node.thenStatement)
    ).length === 1,
    'disabled-preview clicks must not activate the parent frame'
  );
  const tooltip = ancestor(
    slot,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText() === 'Tooltip'
  );
  assert.ok(tooltip);
  assert.match(
    expression(tooltip.openingElement, 'content').getText(),
    /watchlistPreviewDisabled[\s\S]*watchlistPreviewRemove[\s\S]*watchlistPreviewAdd/
  );
  const gate = ancestor(
    tooltip,
    (node) =>
      ts.isConditionalExpression(node) &&
      node.condition.getText() === 'watchlistPreview'
  );
  assert.ok(gate);
  const enabledBranch = ts.isParenthesizedExpression(gate.whenTrue)
    ? gate.whenTrue.expression
    : gate.whenTrue;
  assert.equal(
    enabledBranch,
    tooltip,
    'the prototype belongs only to the preview branch'
  );
  const icons = nodes(button.parent, (node) =>
    ts.isJsxSelfClosingElement(node)
  ).map((node) => node.tagName.getText());
  assert.ok(icons.includes('StarIcon') && icons.includes('SolidStarIcon'));
  for (const icon of nodes(button.parent, ts.isJsxSelfClosingElement)) {
    assert.equal(
      attribute(icon, 'data-icon-tone'),
      undefined,
      'star inherits the hover colour instead of forcing yellow'
    );
  }

  const production = nodes(
    card,
    (node) =>
      ts.isJsxOpeningElement(node) &&
      ['onClickWatchlistBtn', 'onClickDeleteWatchlistBtn'].includes(
        expression(node, 'onClick')?.getText()
      )
  );
  assert.equal(
    production.length,
    2,
    'existing production handlers remain separate'
  );
  for (const control of production) {
    assert.ok(
      ancestor(
        control,
        (node) =>
          ts.isBinaryExpression(node) &&
          node.getText().includes('!watchlistPreview')
      ),
      'production actions are suppressed in preview mode'
    );
  }
  const scope = nodes(
    page,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText() === 'watchlistPreview'
  );
  assert.equal(scope.length, 1);
  assert.match(
    scope[0].initializer.getText(),
    /^process\.env\.NODE_ENV === 'development' &&\s*router\.pathname === '\/discover\/tv'$/
  );
  const forwarded = nodes(
    list,
    (node) =>
      ts.isJsxAttribute(node) && node.name.getText() === 'watchlistPreview'
  );
  assert.equal(forwarded.length, 1);
  const mediaBranch = ancestor(forwarded[0], ts.isCaseClause);
  assert.equal(mediaBranch?.expression.text, 'tv');
  const disabledControl = nodes(
    page,
    (node) =>
      ts.isJsxOpeningElement(node) &&
      expression(node, 'aria-pressed')?.getText() === 'watchlistPreviewDisabled'
  );
  assert.equal(disabledControl.length, 1);
  const disableCalls = nodes(
    expression(disabledControl[0], 'onClick'),
    ts.isCallExpression
  );
  assert.deepEqual(
    disableCalls.map((node) => node.expression.getText()),
    ['setWatchlistPreviewDisabled']
  );

  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1],
    body: match[2],
  }));
  for (const effect of [':hover', ':focus', ':active']) {
    const shared = rules.find((rule) =>
      rule.selector.includes(
        `.poster-control.poster-control-watchlist${effect}`
      )
    );
    assert.ok(
      shared && shared.selector.includes(`.app-button-warning${effect}`),
      `${effect} uses the existing yellow effect owner`
    );
    assert.doesNotMatch(
      shared.body,
      /(?:width|height|padding|font-size|line-height):/
    );
    if (effect === ':hover') assert.match(shared.body, /color:\s*#fff/);
  }
  const palette = rules.find(
    (rule) =>
      rule.selector.includes('.poster-control.poster-control-watchlist') &&
      rule.selector.includes('.poster-control.poster-control-pending')
  );
  assert.ok(palette, 'yellow poster palette is reused, not copied');
  assert.match(palette.body, /var\(--palette-yellow\)/);
  assert.doesNotMatch(
    palette.body,
    /(?:width|height|padding|font-size|line-height):/
  );
  assert.match(
    css,
    /\.poster-control:disabled\s*\{[^}]*cursor: not-allowed;[^}]*opacity: 0\.6;/s
  );
});
