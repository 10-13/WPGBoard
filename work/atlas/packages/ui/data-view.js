/* Reusable, domain-free rows and trees. Data is always inserted as text. */
(function (root) {
  'use strict';
  function createDataRow(label, value, { id } = {}) {
    const row = document.createElement('div'),
      name = document.createElement('span'),
      line = document.createElement('span'),
      result = document.createElement('span');
    row.className = 'atlas-data-row';
    if (id !== undefined) row.dataset.stat = id;
    name.className = 'data-name';
    name.textContent = label;
    line.className = 'data-leader';
    line.setAttribute('aria-hidden', 'true');
    result.className = 'data-value';
    result.textContent = value;
    row.append(name, line, result);
    return row;
  }
  function createDataGroup(label, { id, open = true, onToggle } = {}) {
    const element = document.createElement('details'),
      summary = document.createElement('summary'),
      name = document.createElement('span'),
      body = document.createElement('div');
    element.className = 'atlas-data-group';
    if (id !== undefined) element.dataset.group = id;
    element.open = open;
    name.className = 'data-group-name';
    name.textContent = label;
    summary.append(name);
    body.className = 'data-children';
    element.append(summary, body);
    if (onToggle) element.addEventListener('toggle', () => onToggle(element.open));
    return { element, body };
  }
  function renderDataTree(
    parent,
    nodes,
    {
      expanded = new Map(),
      formatValue = (node) => String(node.value) + (node.unit ? ' ' + node.unit : ''),
    } = {},
  ) {
    const tree = document.createElement('div');
    tree.className = 'atlas-data-tree';
    const render = (node, container, path) => {
      const nextPath = [...path, node.id],
        key = JSON.stringify(nextPath);
      if (node.type === 'folder') {
        let mounted = false;
        const mount = () => {
          if (mounted) return;
          mounted = true;
          for (const child of node.children) render(child, group.body, nextPath);
        };
        const group = createDataGroup(node.title, {
          id: node.id,
          open: expanded.has(key) ? expanded.get(key) : (node.defaultOpen ?? path.length < 3),
          onToggle: (open) => {
            expanded.set(key, open);
            if (open) mount();
          },
        });
        if (group.element.open) mount();
        container.append(group.element);
      } else container.append(createDataRow(node.title, formatValue(node), { id: node.id }));
    };
    for (const node of nodes) render(node, tree, []);
    parent.append(tree);
    return tree;
  }
  Object.assign((root.AtlasUI ||= {}), {
    dataView: { createDataRow, createDataGroup, renderDataTree },
  });
})(globalThis);
