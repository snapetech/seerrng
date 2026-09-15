import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Formik } from 'formik';
import { renderToStaticMarkup } from 'react-dom/server';
import SettingsField from './SettingsField';

describe('SettingsField', () => {
  it('renders checkbox values through the shared selection circle', () => {
    const markup = renderToStaticMarkup(
      <Formik initialValues={{ enabled: true }} onSubmit={() => undefined}>
        <SettingsField type="checkbox" id="enabled" name="enabled" />
      </Formik>
    );

    assert.match(markup, /class="selection-circle"/);
    assert.match(markup, /aria-pressed="true"/);
    assert.doesNotMatch(markup, /type="checkbox"/);
  });

  it('passes ordinary fields through to Formik unchanged', () => {
    const markup = renderToStaticMarkup(
      <Formik initialValues={{ title: 'Seerr' }} onSubmit={() => undefined}>
        <SettingsField type="text" id="title" name="title" />
      </Formik>
    );

    assert.match(markup, /type="text"/);
    assert.match(markup, /value="Seerr"/);
  });
});
