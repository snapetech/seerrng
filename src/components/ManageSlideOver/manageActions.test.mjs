import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createIntl, createIntlCache } from 'react-intl';
import { styleContract } from '../../styles/cssContract.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Shared spacing is configured once, then consumed by card and action roles.
// Check that ownership chain rather than requiring a copied literal per role.
const assertSharedManageSpacing = (css) => {
  const contract = styleContract(css);
  const declaration = (selector, property, expected) => {
    assert.equal(
      contract.declaration(selector, property),
      expected,
      `${selector} ${property}`
    );
  };
  declaration(':root', '--card-layout-spacing', '8px');
  declaration(':root', '--card-spacing', 'var(--card-layout-spacing)');
  declaration(':root', '--main-card-padding', '8px');
  declaration(':root', '--inset-card-padding', '8px');
  for (const selector of [
    '.card-layout',
    '.app-card-main',
    '.app-card-sub',
    '.app-card-inset',
  ]) {
    declaration(selector, '--card-spacing', 'var(--card-layout-spacing)');
  }
  for (const selector of [
    '.manage-request-actions',
    '.manage-advanced-section',
    '.manage-media-stack',
    '.manage-issues-list',
  ]) {
    declaration(selector, 'gap', 'var(--card-spacing)');
  }
  declaration(
    '.card-stack > :not([hidden]) ~ :not([hidden])',
    'margin-block-start',
    'var(--card-spacing)'
  );
  declaration('.card-spacing-before', 'margin-top', 'var(--card-spacing)');
  declaration('.card-spacing-after', 'margin-bottom', 'var(--card-spacing)');
  declaration(
    '.manage-media-dialog',
    'padding',
    'var(--main-card-padding) !important'
  );
  declaration('.manage-issues-panel', 'padding', 'var(--inset-card-padding)');
};
test('Manage icons, counts and disclosure share the global controls', () => {
  const source = read('./ManageMediaActions.tsx');
  assert.match(source, /<ArchiveBoxXMarkIcon aria-hidden="true" \/>/);
  assert.match(source, /<NoSymbolIcon aria-hidden="true" \/>/);
  assert.match(source, /<TrashIcon aria-hidden="true" \/>/);
  assert.match(
    source,
    /<EyeIcon aria-hidden="true" \/>\s*\{intl.formatMessage\(messages.block\)/
  );
  assert.equal(
    (source.match(/className="button-count-badge"/g) ?? []).length,
    2
  );
  assert.doesNotMatch(source, /Issues \(\{count/);
  assert.match(source, /className="disclosure-chevron"/);
  assert.match(
    read('../MediaDetails/DetailDisclosureButton.tsx'),
    /className="disclosure-chevron"/
  );
  assert.match(
    read('../Requests/destructiveActions.tsx'),
    /<TrashIcon aria-hidden="true" \/>/
  );
});
test('inline discussion follows the details without an extra bordered surface', () => {
  const source = read('../IssueList/IssueItem/index.tsx');
  const css = read('../../styles/globals.css');
  assert.match(
    source,
    /className="issue-discussion-content card-spacing-before"/
  );
  assert.doesNotMatch(source, /issue-discussion-inset|messages.viewissue/);
  const rule = css.match(/\.issue-discussion-content\s*\{([^}]*)\}/s)?.[1];
  assert.ok(rule);
  assert.doesNotMatch(rule, /border|background|padding/);
});
test('blocklist buttons use confirmed success while parent refresh catches up', () => {
  const source = read('./ManageMediaActions.tsx');
  assert.match(
    source,
    /await addManageBlocklist[^;]+;\s*await setBlocklisted\(true\)/
  );
  assert.match(
    source,
    /await removeManageBlocklist[^;]+;\s*await setBlocklisted\(false\)/
  );
  assert.doesNotMatch(source, /confirmedBlocklist/);
  assert.match(source, /useTitleBlocklist\(/);
  for (const type of ['Movie', 'Tv', 'Book', 'Music']) {
    const details = read(`../${type}Details/index.tsx`);
    assert.match(details, /useTitleBlocklist\(/);
    assert.match(details, /await setBlocklisted\(true\)/);
  }
  assert.match(source, /const canUnblock =[\s\S]*?isBlocklisted/);
  assert.match(source, /const canBlock =[\s\S]*?!isBlocklisted/);
});
test('confirmation title cards use media title/year rather than service IDs', () => {
  const source = read('./ManageMediaActions.tsx');
  assert.match(source, /titleWithYear: '\{title\} \(\{year\}\)'/);
  assert.match(source, /removeAllTitle: 'Delete From Library\?'/);
  assert.match(source, /blockConfirm: 'Blocklist Title\?'/);
  assert.match(
    source,
    /\{displayTitle\} — \{copy.service\} — \{copy.quality\}/
  );
  assert.doesNotMatch(source, /#\{copy.externalId\}/);
  const titleCard = source
    .match(
      /<div className="card-stack">\s*<p className="([^"]+)">\s*\{displayTitle\}/
    )?.[1]
    .split(/\s+/);
  for (const role of [
    'app-card-inset',
    'app-card-sub',
    'refreshed-inset-surface',
    'request-action-explanation',
  ]) {
    assert.ok(
      titleCard?.includes(role),
      `Missing confirmation title-card role: ${role}`
    );
  }
  assert.doesNotMatch(source, /issues\}\} for \{title\}/);
  assert.match(
    read('./index.tsx'),
    /data\.releaseDate\s*:\s*data\.firstAirDate/
  );
  assert.match(
    read('../ExternalMediaManageSlideOver/index.tsx'),
    /firstPublishYear/
  );
});
test('issue navigation shares the same green color rule as Previous and Next controls', () => {
  const css = read('../../styles/globals.css');
  const contract = styleContract(css);
  assert.equal(
    contract.declaration('.app-button-success', 'border-color'),
    'color-mix(in srgb, var(--palette-green) 90%, transparent)'
  );
  assert.equal(
    contract.declaration('.app-button-success', 'color'),
    'hsl(119 52% 74%)'
  );
  assert.equal(
    contract.declaration('.app-button-success:hover', 'color'),
    '#fff'
  );
  assert.equal(
    contract.declaration('.app-button-success:active', 'color'),
    'hsl(119 52% 74%)'
  );
  assert.match(
    read('./ManageMediaActions.tsx'),
    /buttonType="success"\s*disabled=\{!canViewIssues/
  );
  assert.match(read('../Slider/index.tsx'), /buttonType="success"/);
});
test('Manage uses yellow for closing issues and red for destructive confirmations', () => {
  const source = read('./ManageMediaActions.tsx');
  assert.match(source, /buttonType="warning"[\s\S]*?messages.closeDescription/);
  assert.match(source, /buttonType="danger"[\s\S]*?messages.deleteDescription/);
  assert.match(source, /action === 'closeIssues' \? 'warning' : 'danger'/);
  assert.match(
    source,
    /disabled=\{busy \|\| !!libraryError \|\| !targets.length\}/
  );
});

test('library deletion shares red styling and disabled Manage issue actions keep semantic colors', () => {
  const css = read('../../styles/globals.css');
  const contract = styleContract(css);
  assert.equal(
    contract.declaration('.app-button-danger', 'color'),
    'hsl(0 66% 76%)'
  );
  for (const role of [
    '.request-destructive-action-delete',
    '.request-destructive-action-remove',
  ]) {
    for (const state of ['', ':hover', ':active']) {
      for (const property of ['border-color', 'background-color', 'color']) {
        const expected = contract.declaration(
          `.app-button-danger${state}`,
          property
        );
        assert.ok(expected, `Missing destructive owner: ${property}${state}`);
        assert.equal(
          contract.declaration(`${role}${state}`, property),
          expected
        );
      }
    }
  }
  assert.doesNotMatch(
    css,
    /\.manage-advanced-sections \.app-button-\w+:disabled/
  );
  assert.match(
    read('./ManageMediaActions.tsx'),
    /data-testid="manage-advanced-sections" className="card-stack"/
  );
  const action = read('../Requests/destructiveActions.tsx');
  assert.match(action, /remove: 'Delete From Library'/);
  assert.match(action, /disabled=\{disabled \|\| busy\}/);
});

test('disabled View Issues shares normal disabled styling without text or icon shadows', () => {
  const css = read('../../styles/globals.css');
  assert.match(css, /button\.app-button:disabled\s*\{\s*text-shadow: none;/);
  assert.match(css, /button\.app-button:disabled svg\s*\{\s*filter: none;/);
  const contract = styleContract(css);
  assert.equal(contract.declaration('.app-button:disabled', 'opacity'), '0.6');
  assert.equal(
    contract.declaration('.app-button:disabled', 'cursor'),
    'not-allowed'
  );
  assert.equal(
    contract.declaration('.app-button:disabled', 'filter'),
    undefined
  );
  for (const token of contract.applies('.app-button')) {
    assert.doesNotMatch(token, /disabled:brightness|disabled:grayscale/);
  }
});

test('English defaults render without bundling the catalogue into the app entry', () => {
  const app = read('../../pages/_app.tsx');
  assert.doesNotMatch(
    app,
    /import enMessages from ['"]@app\/i18n\/locale\/en\.json['"]/
  );
  assert.match(app, /const emptyMessages: MessagesType = \{\}/);
  assert.match(
    app,
    /messages=\{currentLocale === 'en' \? emptyMessages : loadedMessages\}/
  );

  const descriptors = read('../../utils/defineMessages.ts');
  assert.match(descriptors, /defaultMessage: messages\[key\]/);

  const intl = createIntl(
    { locale: 'en', defaultLocale: 'en', messages: {} },
    createIntlCache()
  );
  assert.equal(
    intl.formatMessage({
      id: 'components.example.title',
      defaultMessage: 'English title',
    }),
    'English title'
  );
});

for (const file of [
  './index.tsx',
  '../ExternalMediaManageSlideOver/index.tsx',
]) {
  test(`${file} has only shared destructive actions and no forced availability`, () => {
    const source = read(file);
    assert.match(source, /<ManageMediaActions/);
    assert.doesNotMatch(
      source,
      /markAvailable|deleteMediaFile|deleteMedia\s*=|ConfirmButton|manageModalClearMedia|\/available/
    );
    assert.match(read('./ManageMediaActions.tsx'), /buttonType="warning"/);
    assert.doesNotMatch(source, /openIssues.map|<IssueItem/);
    assert.doesNotMatch(source, /label: 'Requests'/);
    assert.doesNotMatch(
      source,
      /label: intl.formatMessage\(messages.manageModalIssues\)/
    );
    assert.doesNotMatch(source, /manageModalAdvanced/);
    assert.match(source, /hideDeleteAction/);
    assert.match(source, /backgroundClickable=\{!confirmationOpen\}/);
    assert.match(source, /onDialogChange=\{setConfirmationOpen\}/);
    assert.match(source, /contentClass="manage-dialog-content"/);
    assert.match(source, /<IssueMediaSummary/);
  });
}
test('global Manage spacing separates 8px padding from gaps and the issue action is not clipped', () => {
  const css = read('../../styles/globals.css');
  assertSharedManageSpacing(css);
  assert.match(css, /\.issue-action-value\s*\{[^}]*overflow: visible/s);
});

test('shared Manage spacing check rejects changed tokens and disconnected gap or margin roles', () => {
  const css = read('../../styles/globals.css');
  for (const [before, after] of [
    ['--card-layout-spacing: 8px;', '--card-layout-spacing: 12px;'],
    ['--card-spacing: var(--card-layout-spacing);', '--card-spacing: 12px;'],
    ['--main-card-padding: 8px;', '--main-card-padding: 12px;'],
    ['--inset-card-padding: 8px;', '--inset-card-padding: 12px;'],
    ['gap: var(--card-spacing);', 'gap: 12px;'],
    ['margin-block-start: var(--card-spacing);', 'margin-block-start: 12px;'],
    ['margin-top: var(--card-spacing);', 'margin-top: 12px;'],
    ['margin-bottom: var(--card-spacing);', 'margin-bottom: 12px;'],
  ]) {
    assert.ok(
      css.includes(before),
      `Missing negative-check fixture: ${before}`
    );
    assert.throws(
      () => assertSharedManageSpacing(css.replaceAll(before, after)),
      undefined,
      before
    );
  }
});

test('Manage buttons no longer show a red issue dot for any media type', () => {
  for (const type of ['Movie', 'Tv', 'Book', 'Music']) {
    assert.doesNotMatch(read(`../${type}Details/index.tsx`), /animate-ping/);
  }
});
test('request screen consumes the same buttons, confirmations and destructive endpoints', () => {
  const source = read('../Requests/index.tsx');
  assert.match(source, /<RequestActionButton/);
  assert.match(source, /<RequestActionConfirmation/);
  assert.match(source, /await deleteRequestStatus\(requestId\)/);
  assert.match(source, /await deleteLibraryMedia\(selection\)/);
});
