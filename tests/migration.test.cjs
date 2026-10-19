'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); require('../packages/core/index.js'); require('../packages/platform/browser.js');
test('legacy parties retain nation ownership, user groups, stable IDs and the original image', () => {
  const legacy = { schemaVersion: 1, saveId: 'old', title: 'Old party', mapName: 'map.png', width: 2, height: 1, baseImage: 'data:image/png;base64,STYLED', indexImage: 'data:image/png;base64,INDEX', provinces: [{ id: 1, area: 1, bbox: [1, 0, 1, 1], anchor: [1, 0] }], nations: [{ id: 'a', name: 'A', color: '#123456' }], regions: [{ id: 'north', name: 'North' }], owners: { 1: 'a' }, regionAssignments: { 1: 'north' }, provinceNames: { 1: 'One' } };
  const p = AtlasPlatform.normalize(legacy, { indexImage: legacy.indexImage, originalImage: 'data:image/png;base64,ORIGINAL' });
  assert.equal(p.schemaVersion, 2); assert.equal(p.map.original.dataURL, 'data:image/png;base64,ORIGINAL'); assert.equal(p.meta.nations.owners[1], 'a'); assert.equal(p.meta.nations.groupAssignments[1], 'north'); assert.equal(p.regions[0].id, 1); assert.equal(p.meta.nations.names[1], 'One'); assert.equal(p.meta.campaign.title, 'Old party'); assert.equal(p.saveKey, 'old');
});
