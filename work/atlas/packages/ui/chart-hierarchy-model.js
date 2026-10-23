/* Layouts only: the same validated hierarchy can be shown without game state or DOM. */
(function (root) {
  'use strict';
  const d3 =
    typeof module !== 'undefined' && module.exports
      ? require('../../vendor/d3-hierarchy/d3-hierarchy.cjs')
      : root.d3;
  const kinds = Object.freeze(['treemap', 'icicle', 'sunburst', 'pack', 'tree', 'cluster']);
  function layout(kind, tree, { width, height, orientation = 'horizontal' } = {}) {
    if (!['icicle', 'sunburst', 'pack', 'tree', 'cluster'].includes(kind))
      throw new TypeError('Неизвестная раскладка иерархии.');
    if (![width, height].every((value) => Number.isFinite(value) && value > 0))
      throw new RangeError('Размеры иерархии должны быть положительными.');
    if (
      !['horizontal', 'vertical', 'radial'].includes(orientation) ||
      (kind === 'icicle' && orientation === 'radial')
    )
      throw new TypeError('Неизвестная ориентация иерархии.');
    const result = d3
      .hierarchy(tree, (item) => (item.children.length ? item.children : null))
      .sum((item) => (item.children.length ? 0 : item.value));
    if (kind === 'pack') d3.pack().size([width, height]).padding(4)(result);
    else if (kind === 'sunburst') d3.partition().size([Math.PI * 2, result.height + 1])(result);
    else if (kind === 'icicle')
      d3.partition().size(orientation === 'vertical' ? [width, height] : [height, width])(result);
    else {
      const radial = orientation === 'radial',
        vertical = orientation === 'vertical';
      const size = radial
        ? [Math.PI * 2, Math.min(width, height) / 2]
        : vertical
          ? [width, height]
          : [height, width];
      (kind === 'tree' ? d3.tree() : d3.cluster()).size(size)(result);
    }
    return { root: result, nodes: result.descendants(), links: result.links() };
  }
  const api = Object.freeze({ kinds, layout });
  Object.assign((root.AtlasUI ||= {}), { hierarchyModel: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
