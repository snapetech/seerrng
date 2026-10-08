import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(
  readFileSync(new URL('./globals.css', import.meta.url), 'utf8')
);
const read = (path) =>
  readFileSync(new URL(`../components/${path}`, import.meta.url), 'utf8');
const declarations = (selector, root = css) => {
  const result = new Map();
  const matches = [];
  root.walkRules(selector, (rule) => {
    const parent = rule.parent;
    if (
      root.type === 'root' &&
      parent?.type === 'atrule' &&
      parent.name === 'media'
    ) {
      return;
    }
    matches.push(rule);
  });
  for (const rule of matches) {
    rule.walkDecls((decl) => result.set(decl.prop, decl.value));
  }
  return result;
};

test('Sportarr league details use shared semantic layout and event roles', () => {
  const detail = read('SportarrDetails/index.tsx');
  for (const role of [
    'sportarr-detail-page',
    'sportarr-detail-navigation',
    'sportarr-detail-facts',
    'sportarr-event-section',
    'sportarr-event-list',
    'sportarr-event-card',
    'sportarr-event-file-ready',
    'sportarr-event-file-missing',
  ]) {
    assert.ok(detail.includes(role), `Sportarr details must use ${role}`);
  }
  assert.equal(declarations('.sportarr-detail-page').get('display'), 'grid');
  assert.ok(
    declarations('.sportarr-detail-page').has('gap'),
    'page spacing stays with the shared style owner'
  );
});

test('event rows keep content readable on narrow screens', () => {
  const base = declarations('.sportarr-event-card');
  assert.equal(base.get('display'), 'grid');
  assert.equal(base.get('grid-template-columns'), 'minmax(0, 1fr) auto');
  assert.equal(base.get('min-width'), '0');
  assert.ok(base.get('padding')?.includes('var(--inset-card-padding)'));

  const narrow = [];
  css.walkAtRules('media', (atRule) => {
    if (atRule.params === '(max-width: 639px)') narrow.push(atRule);
  });
  assert.equal(narrow.length, 1);
  assert.equal(
    declarations('.sportarr-event-card', narrow[0]).get(
      'grid-template-columns'
    ),
    'minmax(0, 1fr)'
  );
  assert.equal(
    declarations('.sportarr-event-state', narrow[0]).get('justify-content'),
    'flex-start'
  );
});

test('event availability remains distinct and uses the semantic success token', () => {
  const detail = read('SportarrDetails/index.tsx');
  assert.match(
    detail,
    /event\.hasFile\s*\?\s*'sportarr-event-file-ready'\s*:\s*'sportarr-event-file-missing'/s
  );
  assert.equal(
    declarations('.sportarr-event-file-ready').get('color'),
    'var(--palette-green-light)'
  );
  assert.equal(
    declarations('.sportarr-event-file-missing').size,
    0,
    'missing files inherit the standard event text role instead of implying success'
  );
});
