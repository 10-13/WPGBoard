'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const components = require('../packages/ui/components.js');

test('the shared component library imports without a document, game core or interface singleton', () => {
  assert.equal(global.document, undefined);
  assert.equal(global.AtlasCore, undefined);
  assert.equal(global.AtlasUI.Interface, undefined);
  assert.equal(global.AtlasUI.components, components);
  assert(Object.isFrozen(components));
  assert.equal(components.createTextInput, global.AtlasUI.controls.createTextInput);
  assert.equal(components.createDataRow, global.AtlasUI.dataView.createDataRow);
  assert.equal(components.createColorScale, global.AtlasUI.controls.createColorScale);
  assert.equal(components.ColorScale, global.AtlasUI.ColorScale);
  assert.equal(new components.ColorScale([{ value: 0, color: '#123456' }]).color(0), '#123456');
});

test('browser assembly exposes the same components without loading a map, core or extension host', () => {
  const sandbox = {};
  for (const file of ['controls', 'color-scale-model', 'color-scale', 'data-view', 'components'])
    vm.runInNewContext(
      fs.readFileSync(require.resolve('../packages/ui/' + file + '.js'), 'utf8'),
      sandbox,
    );
  const api = sandbox.AtlasUI.components;
  assert.deepEqual(Object.keys(api).sort(), Object.keys(components).sort());
  assert.equal(sandbox.AtlasCore, undefined);
  assert.equal(sandbox.document, undefined);
  assert.equal(sandbox.AtlasUI.getUI, undefined);
  assert.equal(sandbox.AtlasUI.ExtensionHost, undefined);
  assert.equal(api.field, sandbox.AtlasUI.controls.field);
  assert.equal(api.renderDataTree, sandbox.AtlasUI.dataView.renderDataTree);
  assert.equal(api.createSelect, sandbox.AtlasUI.controls.createSelect);
});
