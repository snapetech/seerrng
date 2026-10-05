import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourceText = readFileSync(
  new URL('./index.tsx', import.meta.url),
  'utf8'
);
const parseSource = (text) => {
  const source = ts.createSourceFile(
    'MediaSlider.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const nodes = [];
  const visit = (node) => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { source, nodes };
};
const contract = parseSource(sourceText);
const { source, nodes } = contract;

const variableIn = (parsed, name) =>
  parsed.nodes.find(
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(parsed.source) === name
  )?.initializer;
const variable = (name) => variableIn(contract, name);
const attributeIn = (parsed, element, name) =>
  element.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) &&
      property.name.getText(parsed.source) === name
  )?.initializer;
const expressionIn = (parsed, element, name) =>
  attributeIn(parsed, element, name)?.expression;
const expression = (element, name) => expressionIn(contract, element, name);
const evaluate = (initializer, scope, parsedSource = source) =>
  new Function(
    ...Object.keys(scope),
    `return (${initializer.getText(parsedSource)});`
  )(...Object.values(scope));
const selfClosingElement = (parsed, name) =>
  parsed.nodes.find(
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(parsed.source) === name
  );

const slider = selfClosingElement(contract, 'Slider');
const pageError = selfClosingElement(contract, 'PageErrorMessage');

assert.ok(slider, 'MediaSlider renders the shared Slider');
assert.ok(pageError, 'MediaSlider renders the shared provider error notice');

const providerStateIn = (
  parsed,
  { url, data, error, fallbackHasResults, renderableTitles }
) => {
  const isTmdbMovieFeed = evaluate(
    variableIn(parsed, 'isTmdbMovieFeed'),
    { url },
    parsed.source
  );
  const showingSavedResults = evaluate(
    variableIn(parsed, 'showingSavedResults'),
    {
      isTmdbMovieFeed,
      data,
      error,
      fallbackHasResults,
    },
    parsed.source
  );
  const showProviderError = evaluate(
    variableIn(parsed, 'showProviderError'),
    {
      isTmdbMovieFeed,
      error,
      renderableTitles,
    },
    parsed.source
  );
  return { isTmdbMovieFeed, showingSavedResults, showProviderError };
};
const providerState = (values) => providerStateIn(contract, values);

test('stale cached movie data keeps its cards while showing the saved-results notice', () => {
  const staleResponseState = providerState({
    url: '/api/v1/discover/movies',
    data: [{ stale: true, results: [{ id: 438148, mediaType: 'movie' }] }],
    error: undefined,
    fallbackHasResults: true,
    renderableTitles: [{ id: 438148, mediaType: 'movie' }],
  });
  const cachedFallbackState = providerState({
    url: '/api/v1/discover/movies',
    data: [{ stale: false, results: [{ id: 438148, mediaType: 'movie' }] }],
    error: new Error('TMDB unavailable'),
    fallbackHasResults: true,
    renderableTitles: [{ id: 438148, mediaType: 'movie' }],
  });

  assert.deepEqual(staleResponseState, {
    isTmdbMovieFeed: true,
    showingSavedResults: true,
    showProviderError: false,
  });
  assert.deepEqual(cachedFallbackState, {
    isTmdbMovieFeed: true,
    showingSavedResults: true,
    showProviderError: false,
  });
  assert.equal(variable('renderableTitles').getText(source), 'titles');
  assert.match(
    variable('visibleTitles').getText(source),
    /renderableTitles\.slice\(0, MEDIA_SLIDER_TITLE_LIMIT\)/
  );
  assert.equal(expression(slider, 'items').getText(source), 'finalTitles');
  assert.match(
    expression(slider, 'notice').getText(source),
    /^showingSavedResults \|\| showProviderError \?/
  );
  const description = expression(pageError, 'description');
  assert.ok(ts.isConditionalExpression(description));
  assert.equal(description.condition.getText(source), 'showingSavedResults');
  assert.equal(
    description.whenTrue.getText(source),
    'intl.formatMessage(messages.showingSavedResults)'
  );
  assert.equal(description.whenFalse.getText(source), 'undefined');
});

test('an empty movie-provider failure shows the error notice without broadening to other feeds', () => {
  const movieState = providerState({
    url: '/api/v1/discover/movies',
    data: undefined,
    error: new Error('TMDB unavailable'),
    fallbackHasResults: false,
    renderableTitles: [],
  });
  const seriesState = providerState({
    url: '/api/v1/discover/tv',
    data: undefined,
    error: new Error('provider unavailable'),
    fallbackHasResults: false,
    renderableTitles: [],
  });

  assert.deepEqual(movieState, {
    isTmdbMovieFeed: true,
    showingSavedResults: false,
    showProviderError: true,
  });
  assert.deepEqual(seriesState, {
    isTmdbMovieFeed: false,
    showingSavedResults: false,
    showProviderError: false,
  });
  assert.equal(
    expression(pageError, 'title').getText(source),
    'intl.formatMessage(messages.tmdbUnavailable)'
  );
});

test('the provider notice retry invokes the SWR recovery callback', () => {
  const retry = expression(pageError, 'retry');
  assert.ok(ts.isObjectLiteralExpression(retry));
  const retryProperties = Object.fromEntries(
    retry.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => [
        property.name.getText(source),
        property.initializer.getText(source),
      ])
  );
  assert.deepEqual(retryProperties, {
    onClick: 'revalidate',
    tooltip: 'intl.formatMessage(messages.tryAgain)',
  });

  const swrBinding = nodes.find(
    (node) =>
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer?.getText(source).startsWith('useSWRInfinite<')
  );
  assert.ok(swrBinding);
  assert.ok(
    swrBinding.name.elements.some(
      (element) =>
        element.propertyName?.getText(source) === 'mutate' &&
        element.name.getText(source) === 'revalidate'
    ),
    'retry remains wired to the mutate callback returned by useSWRInfinite'
  );
});

const fixture = (current, replacement) => {
  assert.ok(
    sourceText.includes(current),
    `negative fixture target exists: ${current}`
  );
  return parseSource(sourceText.replace(current, replacement));
};

test('provider notice checks reject lost cards, broadened feeds, and disconnected retries', () => {
  const lostCards = fixture('items={finalTitles}', 'items={[]}');
  const lostCardsSlider = selfClosingElement(lostCards, 'Slider');
  assert.throws(
    () =>
      assert.equal(
        expressionIn(lostCards, lostCardsSlider, 'items').getText(
          lostCards.source
        ),
        'finalTitles',
        'stale results must retain their rendered cards'
      ),
    /stale results must retain their rendered cards/
  );

  const broadenedFeed = fixture(
    "const isTmdbMovieFeed = url === '/api/v1/discover/movies';",
    'const isTmdbMovieFeed = true;'
  );
  assert.throws(
    () =>
      assert.equal(
        providerStateIn(broadenedFeed, {
          url: '/api/v1/discover/tv',
          data: undefined,
          error: new Error('provider unavailable'),
          fallbackHasResults: false,
          renderableTitles: [],
        }).showProviderError,
        false,
        'provider notice must remain scoped to movie discovery'
      ),
    /provider notice must remain scoped to movie discovery/
  );

  const disconnectedRetry = fixture(
    'onClick: revalidate,',
    'onClick: () => undefined,'
  );
  const disconnectedPageError = selfClosingElement(
    disconnectedRetry,
    'PageErrorMessage'
  );
  const retry = expressionIn(disconnectedRetry, disconnectedPageError, 'retry');
  const onClick = retry.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText(disconnectedRetry.source) === 'onClick'
  );
  assert.throws(
    () =>
      assert.equal(
        onClick.initializer.getText(disconnectedRetry.source),
        'revalidate',
        'retry must remain wired to SWR recovery'
      ),
    /retry must remain wired to SWR recovery/
  );
});
