import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  validateRefreshedUiStyleBoundaries,
} = require('./check-refreshed-ui-style-lib.js');

const validSharedStyles = `
  .app-button {}
  .app-button-primary {}
  .app-button-warning {}
  .app-button-danger {}
  .app-button-success {}
  .button-standard, .button-sm {}
  .detail-disclosure-control {}
  .media-quality-select-control {}
  .media-detail-column-divider {}
  .media-rating-row {}
  .media-primary-action-row {}
  .scrollable-card {}
  .refreshed-card-surface {}
  .refreshed-inset-surface {}
  .refreshed-artwork-scrim {}
  .request-card-artwork-gradient {}
`;

test('accepts shared blue surfaces and semantic card text', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = () => (
        <article className="refreshed-card-surface">
          <section className="refreshed-inset-surface">
            <p className="refreshed-detail-text-muted">Details</p>
          </section>
        </article>
      );
    `,
  });
  assert.deepStrictEqual(result.errors, []);
});

test('rejects visual inline and embedded styles in refreshed components', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = () => (
        <article className="refreshed-card-surface" style={{ backgroundColor: '#111827' }}>
          <style>{'.card { color: gray; }'}</style>
        </article>
      );
    `,
  });
  assert.ok(result.errors.some((error) => error.includes('visual inline')));
  assert.ok(result.errors.some((error) => error.includes('embedded style')));
});

test('rejects neutral text and nested near-black cards inside shared surfaces', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = () => (
        <article className="refreshed-card-surface">
          <p className="text-gray-400">Details</p>
          <div className="rounded-lg border border-gray-700 bg-gray-900">Nested</div>
        </article>
      );
    `,
  });
  assert.ok(result.errors.some((error) => error.includes('neutral gray')));
  assert.ok(result.errors.some((error) => error.includes('nested card')));
});

test('allows data-driven geometry without permitting visual overrides', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = ({ width }) => (
        <article className="refreshed-card-surface">
          <div className="h-2" style={{ width }} />
        </article>
      );
    `,
  });
  assert.deepStrictEqual(result.errors, []);
});

test('requires every approved shared style reference to exist', () => {
  const rejected = validateRefreshedUiStyleBoundaries({
    'src/styles/globals.css': `
      .app-button {}
    `,
  });
  assert.ok(
    rejected.errors.some((error) => error.includes('required shared style'))
  );

  const accepted = validateRefreshedUiStyleBoundaries({
    'src/styles/globals.css': validSharedStyles,
  });
  assert.deepStrictEqual(accepted.errors, []);
});

test('does not duplicate CSS property values in the reference validator', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/styles/globals.css': validSharedStyles.replace(
      '.app-button-primary {}',
      '.app-button-primary { background: anything; }'
    ),
  });
  assert.deepStrictEqual(result.errors, []);
});

test('rejects pseudo-element dividers and the larger legacy action token', () => {
  const result = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Example = () => (
        <Button
          buttonSize="default"
          className="before:absolute before:left-0 before:w-px"
        />
      );
    `,
  });
  assert.ok(
    result.errors.some((error) => error.includes('ordinary border class'))
  );
  assert.ok(
    result.errors.some((error) => error.includes('larger legacy size'))
  );
});

test('allows the marked runtime Theme Picker swatch only', () => {
  const accepted = validateRefreshedUiStyleBoundaries({
    'src/components/Layout/ThemePicker/index.tsx': `
      export const Swatch = ({ swatch }) => (
        <span data-theme-swatch style={{ backgroundColor: swatch }} />
      );
    `,
  });
  assert.deepStrictEqual(accepted.errors, []);

  const rejected = validateRefreshedUiStyleBoundaries({
    'src/components/Example/index.tsx': `
      export const Swatch = ({ swatch }) => (
        <span style={{ backgroundColor: swatch }} />
      );
    `,
  });
  assert.ok(rejected.errors.some((error) => error.includes('visual inline')));
});
