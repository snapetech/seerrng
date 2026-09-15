/* eslint-disable @typescript-eslint/no-require-imports -- Shared CommonJS validator used by the repository scripts and Node tests. */
const ts = require('typescript');

const CONTAINER_TAGS = new Set([
  'article',
  'aside',
  'div',
  'dl',
  'li',
  'main',
  'section',
]);

const isScopedFile = (fileName) => fileName.startsWith('src/components/');

const getAttribute = (opening, name) =>
  opening.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.getText() === name
  );

const getAttributeText = (attribute, sourceFile) => {
  if (!attribute?.initializer) return '';
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }
  if (ts.isJsxExpression(attribute.initializer)) {
    return attribute.initializer.expression?.getText(sourceFile) ?? '';
  }
  return attribute.initializer.getText(sourceFile);
};

const hasDirectMutedGrayText = (classText) =>
  /(?:^|[\s'"`])text-gray-(?:400|500)(?=$|[\s'"`}])/.test(classText);

const hasNeutralCardSurface = (tagName, classText) =>
  CONTAINER_TAGS.has(tagName) &&
  /(?:^|[\s'"`])rounded-(?:lg|xl)(?=$|[\s'"`}])/.test(classText) &&
  /(?:^|[\s'"`])border(?:-[^\s'"`}]+)?(?=$|[\s'"`}])/.test(classText) &&
  /(?:^|[\s'"`])bg-(?:black|gray-(?:800|900|950))(?:\/[^\s'"`}]+)?(?=$|[\s'"`}])/.test(
    classText
  );

const hasVisualInlineProperty = (styleText) =>
  /\b(?:background|backgroundColor|backgroundImage|borderColor|boxShadow|color|filter|opacity|textShadow|backdropFilter)\s*:/.test(
    styleText
  );

const isApprovedDynamicThemeSwatch = (opening, styleText) =>
  Boolean(getAttribute(opening, 'data-theme-swatch')) &&
  /^\{?\s*backgroundColor:\s*swatch\s*\}?$/.test(styleText);

const hasPseudoElementDivider = (classText) =>
  /(?:before|after):(?:w-px|border-[lr](?:-[^\s'"`}]+)?)(?=$|[\s'"`}])/.test(
    classText
  );

const normalizedAttributeValue = (attribute, sourceFile) =>
  getAttributeText(attribute, sourceFile).replace(/^['"]|['"]$/g, '');

const sharedStyleReferencePattern =
  /(?:^|[\s'"`])((?:app|auth|association|detail|discover|format|manage|media|refreshed|request|scrollable|selection|title-card)-[a-z0-9-]+)/g;

const stylesheetDefines = (stylesheet, className) => {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${escaped}(?=[\\s,{:.>])`).test(stylesheet);
};

const validateGlobalStylesheet = (fileName, source) => {
  const errors = [];
  const requiredSharedSelectors = [
    '.app-button',
    '.app-button-primary',
    '.app-button-warning',
    '.app-button-danger',
    '.app-button-success',
    '.button-standard',
    '.detail-disclosure-control',
    '.media-quality-select-control',
    '.media-detail-column-divider',
    '.media-rating-row',
    '.media-primary-action-row',
    '.scrollable-card',
    '.refreshed-card-surface',
    '.refreshed-inset-surface',
    '.refreshed-artwork-scrim',
    '.request-card-artwork-gradient',
  ];

  requiredSharedSelectors.forEach((selector) => {
    if (!source.includes(`${selector} {`) && !source.includes(`${selector},`)) {
      errors.push(
        `${fileName}:1: required shared style reference is missing (${selector})`
      );
    }
  });

  return errors;
};

const validateRefreshedUiStyleBoundaries = (files) => {
  const errors = [];
  let scopedFileCount = 0;
  const globalStyles = files['src/styles/globals.css'] ?? '';

  for (const [fileName, source] of Object.entries(files)) {
    if (fileName === 'src/styles/globals.css') {
      errors.push(...validateGlobalStylesheet(fileName, source));
      continue;
    }
    if (!isScopedFile(fileName)) continue;
    scopedFileCount += 1;

    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const seen = new Set();
    const report = (node, message) => {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const key = `${line}:${message}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(`${fileName}:${line}: ${message}`);
      }
    };

    const visit = (node, insideSharedSurface = false) => {
      let nextInsideSharedSurface = insideSharedSurface;

      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tagName = opening.tagName.getText(sourceFile);
        const classText = getAttributeText(
          getAttribute(opening, 'className'),
          sourceFile
        );
        const ownsSharedSurface =
          classText.includes('refreshed-card-surface') ||
          classText.includes('refreshed-inset-surface');
        nextInsideSharedSurface = insideSharedSurface || ownsSharedSurface;

        if (globalStyles) {
          const sharedReferences = Array.from(
            classText.matchAll(sharedStyleReferencePattern),
            (match) => match[1]
          );
          sharedReferences.forEach((className) => {
            if (!stylesheetDefines(globalStyles, className)) {
              report(
                opening,
                `shared style reference has no global CSS definition (${className})`
              );
            }
          });
        }

        if (tagName === 'style') {
          report(
            opening,
            'embedded style blocks are not allowed in refreshed UI'
          );
        }

        const styleAttribute = getAttribute(opening, 'style');
        if (
          styleAttribute &&
          hasVisualInlineProperty(
            getAttributeText(styleAttribute, sourceFile)
          ) &&
          !isApprovedDynamicThemeSwatch(
            opening,
            getAttributeText(styleAttribute, sourceFile)
          )
        ) {
          report(
            styleAttribute,
            'visual inline styles must be moved to the shared global stylesheet'
          );
        }

        if (hasPseudoElementDivider(classText)) {
          report(
            opening,
            'column dividers must use the shared ordinary border class, never a pseudo-element'
          );
        }

        for (const sizeAttributeName of ['buttonSize', 'actionButtonSize']) {
          const sizeAttribute = getAttribute(opening, sizeAttributeName);
          if (
            sizeAttribute &&
            normalizedAttributeValue(sizeAttribute, sourceFile) === 'default'
          ) {
            report(
              sizeAttribute,
              `${sizeAttributeName}="default" is the larger legacy size; use the explicit shared standard token`
            );
          }
        }

        if (nextInsideSharedSurface && hasDirectMutedGrayText(classText)) {
          report(
            opening,
            'neutral gray card text must use refreshed-detail-text or refreshed-detail-text-muted'
          );
        }

        if (
          nextInsideSharedSurface &&
          hasNeutralCardSurface(tagName, classText) &&
          !ownsSharedSurface
        ) {
          report(
            opening,
            'nested card surfaces must use refreshed-card-surface or refreshed-inset-surface'
          );
        }
      }

      node.forEachChild((child) => visit(child, nextInsideSharedSurface));
    };

    visit(sourceFile);
  }

  return { errors, scopedFileCount };
};

module.exports = {
  isScopedFile,
  validateRefreshedUiStyleBoundaries,
};
