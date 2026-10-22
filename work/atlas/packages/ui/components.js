/* Public UI foundation: no game state, map, extension host or startup side effects. */
(function (root) {
  'use strict';
  const commonJS = typeof module !== 'undefined' && module.exports;
  const controls = commonJS ? require('./controls.js') : root.AtlasUI.controls;
  const dataView = commonJS ? require('./data-view.js') : root.AtlasUI.dataView;
  const { ColorScale } = commonJS ? require('./color-scale-model.js') : root.AtlasUI;
  const { createColorScale } = commonJS ? require('./color-scale.js') : root.AtlasUI;
  const api = Object.freeze({ ...controls, ...dataView, ColorScale, createColorScale });
  Object.assign((root.AtlasUI ||= {}), { components: api });
  if (commonJS) module.exports = api;
})(globalThis);
