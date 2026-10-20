/* One canonical record per nation pair: war is always mutual. */
(function (root) {
  'use strict';
  const warKey = (a, b) => JSON.stringify([a, b].sort());
  function isAtWar(nations, a, b) {
    if (!a || !b || a === b || !Object.hasOwn(nations.items || {}, a) || !Object.hasOwn(nations.items || {}, b)) return false;
    const pair = nations.wars?.[warKey(a, b)], sorted = [a, b].sort();
    return Array.isArray(pair) && pair.length === 2 && pair[0] === sorted[0] && pair[1] === sorted[1];
  }
  function enemyIds(nations, id) {
    if (!Object.hasOwn(nations.items || {}, id)) return [];
    return Object.keys(nations.items).filter(other => isAtWar(nations, id, other));
  }
  const api = { warKey, isAtWar, enemyIds };
  Object.assign(root.AtlasExtensions ||= {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
