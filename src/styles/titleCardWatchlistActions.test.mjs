import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import postcss from 'postcss';

const require = createRequire(path.resolve('package.json'));
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
const { act } = React;
const sourceRoot = process.env.TITLE_CARD_TEST_SOURCE_ROOT ?? '.';
const source = fs.readFileSync(
  path.resolve(sourceRoot, 'src/components/TitleCard/index.tsx'),
  'utf8'
);
const sourceFile = ts.createSourceFile(
  'TitleCard/index.tsx',
  source,
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
const attributeExpression = (opening, name) =>
  opening.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.getText() === name
  )?.initializer?.expression;
const ancestor = (node, predicate) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (predicate(parent)) return parent;
  }
  return undefined;
};
let environment;

const component = (tag = 'div') => {
  const Component = ({ children, ...props }) =>
    React.createElement(tag, props, children);
  return Component;
};
const icon = (props) => React.createElement('svg', props);
const Button = ({ buttonType, buttonSize, iconOnly, children, ...props }) =>
  React.createElement('button', props, children);
const CachedImage = ({
  type,
  fallbackSrc,
  errorFallbackSrc,
  fill,
  priority,
  ...props
}) => React.createElement('img', props);
const globalMessages = new Proxy(
  {},
  {
    get: (_target, key) => ({ defaultMessage: String(key) }),
  }
);
const deps = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  '@app/assets/spinner.svg': {
    default: component('span'),
    __esModule: true,
  },
  '@app/components/Association/AssociationBadge': {
    default: component(),
    __esModule: true,
  },
  '@app/components/BlocklistConfirmationModal': {
    default: component(),
    __esModule: true,
  },
  '@app/components/Common/BookFormatBadge': {
    default: component(),
    getBookFormatMessage: (format) => ({ defaultMessage: format }),
    __esModule: true,
  },
  '@app/components/Common/Button': {
    default: Button,
    __esModule: true,
  },
  '@app/components/Common/CachedImage': {
    default: CachedImage,
    __esModule: true,
  },
  '@app/components/Common/MediaTypeBadge': {
    default: component(),
    __esModule: true,
  },
  '@app/components/Common/StatusBadgeMini': {
    default: component(),
    __esModule: true,
  },
  '@app/components/Common/Tooltip': {
    default: ({ content, children }) =>
      React.createElement('div', { title: content }, children),
    __esModule: true,
  },
  '@app/components/Common/WatchedBadge': {
    default: component(),
    __esModule: true,
  },
  '@app/components/TitleCard/ErrorCard': {
    default: component(),
    __esModule: true,
  },
  '@app/components/TitleCard/Placeholder': {
    default: component(),
    __esModule: true,
  },
  '@app/components/TitleCard/PosterRatingPopover': {
    default: () => null,
    __esModule: true,
  },
  '@app/components/TitleCard/bookDetailQuery': {
    getTitleCardBookDetailQuery: () => ({}),
  },
  '@app/components/TitleCard/statusBadges': {
    getTitleCardStatusBadges: () => [],
    getTitleCardStatusBadgeSlots: () => ({}),
  },
  '@app/hooks/useAlbumArtwork': {
    default: (_id, image) => image,
    __esModule: true,
  },
  '@app/hooks/useIsTouch': {
    useIsTouch: () => false,
  },
  '@app/hooks/useSettings': {
    default: () => ({
      currentSettings: { movie4kEnabled: false, series4kEnabled: false },
    }),
    __esModule: true,
  },
  '@app/hooks/useToasts': {
    default: () => ({
      addToast: (...args) => environment.toasts.push(args),
    }),
    __esModule: true,
  },
  '@app/hooks/useUser': {
    Permission: new Proxy({}, { get: (_target, key) => key }),
    UserType: { PLEX: 'plex' },
    useUser: () => ({
      user: { id: 7, userType: 'local' },
      hasPermission: () => false,
    }),
  },
  '@app/hooks/useWatchStatus': {
    default: () => ({}),
    __esModule: true,
  },
  '@app/i18n/globalMessages': {
    default: globalMessages,
    __esModule: true,
  },
  '@app/utils/apiPath': {
    encodeApiPathSegment: encodeURIComponent,
    normalizeExternalTitleId: (_mediaType, id) => id,
  },
  '@app/utils/defineMessages': {
    default: (_id, messages) =>
      Object.fromEntries(
        Object.entries(messages).map(([key, defaultMessage]) => [
          key,
          { defaultMessage },
        ])
      ),
    __esModule: true,
  },
  '@app/utils/imageCache': {
    getTmdbPosterImageUrl: (value) => value,
    isResolvedImageUrl: (value) => Boolean(value),
  },
  '@app/utils/typeHelpers': {
    withProperties: (Component, properties) =>
      Object.assign(Component, properties),
  },
  '@headlessui/react': {
    Transition: ({ show, children }) => (show ? children : null),
  },
  '@heroicons/react/24/outline': {
    ArrowDownTrayIcon: icon,
    EyeIcon: icon,
    EyeSlashIcon: icon,
    MinusCircleIcon: icon,
    StarIcon: icon,
  },
  '@heroicons/react/24/solid': {
    StarIcon: icon,
  },
  '@server/constants/media': {
    MediaStatus: {
      AVAILABLE: 'available',
      BLOCKLISTED: 'blocklisted',
      DELETED: 'deleted',
      PARTIALLY_AVAILABLE: 'partially_available',
      PENDING: 'pending',
      PROCESSING: 'processing',
      UNKNOWN: 'unknown',
    },
  },
  axios: {
    default: {
      get: async () => ({}),
      post: (...args) => {
        environment.posts.push(args);
        return environment.post(...args);
      },
      delete: (...args) => {
        environment.deletes.push(args);
        return environment.delete(...args);
      },
    },
    __esModule: true,
  },
  'next/dynamic': {
    default: () => () => null,
    __esModule: true,
  },
  'next/link': {
    default: ({ children }) =>
      React.createElement('a', { href: '#' }, children),
    __esModule: true,
  },
  'next/router': {
    useRouter: () => ({ push: async () => true }),
  },
  'react-intl': {
    useIntl: () => ({
      formatMessage: (message, values = {}) =>
        (message?.defaultMessage ?? '').replace(/\{(\w+)\}/g, (_match, key) =>
          String(values[key] ?? '')
        ),
    }),
  },
  swr: {
    default: () => ({}),
    mutate: (...args) => environment.mutations.push(args),
    __esModule: true,
  },
};
const compiledModule = { exports: {} };
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
new Function('require', 'module', 'exports', javascript)(
  (id) => {
    assert.ok(id in deps, `Unexpected dependency ${id}`);
    return deps[id];
  },
  compiledModule,
  compiledModule.exports
);
const TitleCard = compiledModule.exports.default;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const addLabel = 'Add Fixture title to your Watchlist.';
const removeLabel = 'Remove Fixture title from your Watchlist.';

test('production watchlist controls keep their interactive slot and keyboard boundary', () => {
  const controls = nodes(
    sourceFile,
    (node) =>
      ts.isJsxOpeningElement(node) &&
      ['onClickWatchlistBtn', 'onClickDeleteWatchlistBtn'].includes(
        attributeExpression(node, 'onClick')?.getText()
      )
  );
  assert.equal(controls.length, 2);
  for (const control of controls) {
    assert.equal(
      attributeExpression(control, 'disabled')?.getText(),
      'isUpdating'
    );
    assert.equal(
      attributeExpression(control, 'aria-busy')?.getText(),
      'isUpdating'
    );
    assert.match(
      attributeExpression(control, 'aria-label')?.getText() ?? '',
      /(?:add|remove)WatchlistDescription/
    );
    assert.match(
      attributeExpression(control, 'onKeyDown')?.getText() ?? '',
      /event\.stopPropagation\(\)/
    );
    assert.ok(
      ancestor(
        control,
        (node) =>
          ts.isJsxElement(node) &&
          node.openingElement.attributes.properties.some(
            (entry) =>
              ts.isJsxAttribute(entry) &&
              entry.name.getText() === 'data-poster-region' &&
              entry.initializer?.text === 'watchlist-slot'
          )
      )
    );
  }
});

const fixture = async ({ added = false, post, remove } = {}) => {
  environment = {
    posts: [],
    deletes: [],
    mutations: [],
    toasts: [],
    post: post ?? (async () => ({ data: {} })),
    delete: remove ?? (async () => ({ status: 204 })),
  };
  const env = environment;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(TitleCard, {
        id: 'fixture-book',
        image: 'https://example.test/poster.jpg',
        isAddedToWatchlist: added,
        mediaType: 'book',
        requestable: false,
        title: 'Fixture title',
      })
    );
    await tick();
  });
  await act(async () => {
    container
      .querySelector('[data-poster-region="frame"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await tick();
  });
  const action = () =>
    [...container.querySelectorAll('button')].find((button) =>
      [addLabel, removeLabel].includes(button.getAttribute('aria-label'))
    );
  return {
    env,
    action,
    doubleClick: async () => {
      const button = action();
      await act(async () => {
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
    },
    click: async () => {
      const button = action();
      await act(async () => {
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
    },
    settle: async (callback) => {
      await act(async () => {
        callback();
        await tick();
      });
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
};

test('add action is named, guarded synchronously, and changes state only on a confirmed response', async () => {
  const rejected = deferred();
  const failed = await fixture({ post: () => rejected.promise });
  assert.equal(failed.action()?.getAttribute('aria-label'), addLabel);
  assert.equal(
    failed.action()?.closest('[title]')?.getAttribute('title'),
    addLabel
  );
  await failed.doubleClick();
  assert.equal(failed.env.posts.length, 1);
  assert.equal(failed.action()?.disabled, true);
  assert.equal(failed.action()?.getAttribute('aria-busy'), 'true');
  await failed.settle(() => rejected.reject(new Error('request failed')));
  assert.equal(failed.action()?.getAttribute('aria-label'), addLabel);
  assert.equal(failed.action()?.disabled, false);
  assert.equal(failed.env.mutations.length, 0);
  await failed.cleanup();

  const malformedResponse = deferred();
  const malformed = await fixture({ post: () => malformedResponse.promise });
  await malformed.click();
  await malformed.settle(() => malformedResponse.resolve({}));
  assert.equal(malformed.action()?.getAttribute('aria-label'), addLabel);
  assert.equal(malformed.env.mutations.length, 0);
  await malformed.cleanup();

  const emptyObjectResponse = deferred();
  const emptyObject = await fixture({
    post: () => emptyObjectResponse.promise,
  });
  await emptyObject.click();
  await emptyObject.settle(() => emptyObjectResponse.resolve({ data: {} }));
  assert.equal(emptyObject.action()?.getAttribute('aria-label'), addLabel);
  assert.equal(emptyObject.env.mutations.length, 0);
  await emptyObject.cleanup();

  const confirmedResponse = deferred();
  const confirmed = await fixture({ post: () => confirmedResponse.promise });
  await confirmed.click();
  await confirmed.settle(() => confirmedResponse.resolve({ data: { id: 1 } }));
  assert.equal(confirmed.action()?.getAttribute('aria-label'), removeLabel);
  assert.equal(confirmed.env.mutations.length, 1);
  await confirmed.cleanup();
});

test('remove action is named, guarded synchronously, and changes state only after status 204', async () => {
  const rejected = deferred();
  const failed = await fixture({
    added: true,
    remove: () => rejected.promise,
  });
  assert.equal(failed.action()?.getAttribute('aria-label'), removeLabel);
  assert.equal(
    failed.action()?.closest('[title]')?.getAttribute('title'),
    removeLabel
  );
  await failed.doubleClick();
  assert.equal(failed.env.deletes.length, 1);
  assert.equal(failed.action()?.disabled, true);
  await failed.settle(() => rejected.reject(new Error('request failed')));
  assert.equal(failed.action()?.getAttribute('aria-label'), removeLabel);
  assert.equal(failed.env.mutations.length, 0);
  await failed.cleanup();

  const malformedResponse = deferred();
  const malformed = await fixture({
    added: true,
    remove: () => malformedResponse.promise,
  });
  await malformed.click();
  await malformed.settle(() => malformedResponse.resolve({ status: 200 }));
  assert.equal(malformed.action()?.getAttribute('aria-label'), removeLabel);
  assert.equal(malformed.env.mutations.length, 0);
  await malformed.cleanup();

  const confirmedResponse = deferred();
  const confirmed = await fixture({
    added: true,
    remove: () => confirmedResponse.promise,
  });
  await confirmed.click();
  await confirmed.settle(() => confirmedResponse.resolve({ status: 204 }));
  assert.equal(confirmed.action()?.getAttribute('aria-label'), addLabel);
  assert.equal(confirmed.env.mutations.length, 1);
  await confirmed.cleanup();
});

const loadingPosterSelector = ".poster-layout[data-poster-state='loading']";
const reducedMotionMedia = '(prefers-reduced-motion: reduce)';
const geometryProperties = new Set([
  'aspect-ratio',
  'bottom',
  'display',
  'height',
  'inset',
  'left',
  'margin',
  'margin-block',
  'margin-inline',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'padding',
  'padding-block',
  'padding-inline',
  'position',
  'right',
  'top',
  'width',
]);
const mediaAncestor = (rule) => {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name === 'media') return parent;
  }
  return undefined;
};
const declarations = (rule, property) =>
  rule.nodes
    .filter((node) => node.type === 'decl' && node.prop === property)
    .map((node) => node.value);
const assertReducedMotionContract = (source) => {
  const root = postcss.parse(source);
  const loadingRules = [];
  root.walkRules((rule) => {
    if (rule.selectors.includes(loadingPosterSelector)) loadingRules.push(rule);
  });
  const normalOwners = loadingRules.filter((rule) => !mediaAncestor(rule));
  assert.equal(normalOwners.length, 1, 'loading poster keeps one normal owner');
  assert.deepEqual(
    declarations(normalOwners[0], 'animation'),
    ['poster-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'],
    'normal motion keeps the accepted poster pulse'
  );

  const reducedOwners = loadingRules.filter(
    (rule) => mediaAncestor(rule)?.params === reducedMotionMedia
  );
  assert.equal(
    reducedOwners.length,
    1,
    'loading poster keeps one reduced-motion owner'
  );
  const reducedOwner = reducedOwners[0];
  assert.equal(
    reducedOwner.parent.type,
    'atrule',
    'reduced-motion owner belongs directly to its media rule'
  );
  assert.equal(reducedOwner.parent.name, 'media');
  assert.equal(reducedOwner.parent.params, reducedMotionMedia);
  assert.deepEqual(
    declarations(reducedOwner, 'animation'),
    ['none'],
    'reduced motion disables the loading animation'
  );
  assert.deepEqual(
    reducedOwner.nodes
      .filter(
        (node) => node.type === 'decl' && geometryProperties.has(node.prop)
      )
      .map((node) => node.prop),
    [],
    'reduced-motion owner does not change poster geometry'
  );
};

test('loading poster pulse keeps normal geometry and is suppressed for reduced motion', () => {
  const css = fs.readFileSync(
    path.resolve(sourceRoot, 'src/styles/globals.css'),
    'utf8'
  );
  assertReducedMotionContract(css);

  const missingContract = postcss.parse(css);
  let removed = 0;
  missingContract.walkAtRules('media', (media) => {
    if (media.params !== reducedMotionMedia) return;
    media.walkRules((rule) => {
      if (!rule.selectors.includes(loadingPosterSelector)) return;
      rule.remove();
      removed++;
    });
  });
  assert.equal(removed, 1, 'negative fixture removes the owned motion rule');
  assert.throws(
    () => assertReducedMotionContract(missingContract.toString()),
    /reduced-motion owner/
  );
});
