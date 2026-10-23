/* Experimental multi-column data view; sorting never mutates caller-owned rows. */
(function (root) {
  'use strict';
  const commonJS = typeof module !== 'undefined' && module.exports;
  const { el, button } = commonJS ? require('./controls.js') : root.AtlasUI.controls;
  const numbers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  function createTable(columns, input, initial = {}) {
    const node = el('div', 'atlas-table'),
      table = el('table'),
      caption = el('div', 'atlas-table-caption');
    node.append(table, caption);
    let options = initial,
      fields,
      rows,
      sortKey = null,
      descending = false,
      selected = null,
      disposed = false,
      headings = new Map();
    function render() {
      table.replaceChildren();
      headings = new Map();
      table.setAttribute('aria-label', options.label || 'Таблица данных');
      const colgroup = el('colgroup'),
        head = el('thead'),
        header = el('tr'),
        body = el('tbody');
      const totalWidth = fields.reduce((sum, column) => sum + (column.width || 1), 0);
      for (const column of fields) {
        const col = el('col');
        col.style.width = ((column.width || 1) / totalWidth) * 100 + '%';
        colgroup.append(col);
        const th = el('th');
        th.setAttribute('scope', 'col');
        th.setAttribute(
          'aria-sort',
          sortKey === column.key ? (descending ? 'descending' : 'ascending') : 'none',
        );
        const sort = button('', () => {
          descending = sortKey === column.key ? !descending : false;
          sortKey = column.key;
          render();
          headings.get(column.key)?.focus?.({ preventScroll: true });
        });
        headings.set(column.key, sort);
        sort.className = 'atlas-table-heading';
        sort.setAttribute('aria-label', 'Сортировать: ' + column.label);
        sort.append(
          el('span', '', column.label + (sortKey === column.key ? (descending ? ' ↓' : ' ↑') : '')),
        );
        th.append(sort);
        header.append(th);
      }
      head.append(header);
      const ordered = rows.map((row, index) => ({ row, index }));
      if (sortKey)
        ordered.sort((a, b) => {
          const av = a.row[sortKey],
            bv = b.row[sortKey];
          if (av == null || bv == null)
            return av == null && bv == null ? a.index - b.index : av == null ? 1 : -1;
          const value =
            typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : collator.compare(String(av), String(bv));
          return (descending ? -value : value) || a.index - b.index;
        });
      for (const { row, index } of ordered) {
        const tr = el('tr'),
          id = row.id ?? index;
        tr.classList.toggle('is-selected', selected === id);
        if (options.onSelect) {
          tr.tabIndex = 0;
          tr.setAttribute('aria-selected', String(selected === id));
          const select = (event) => {
            selected = id;
            for (const sibling of body.children) {
              sibling.classList.toggle('is-selected', sibling === tr);
              sibling.setAttribute('aria-selected', String(sibling === tr));
            }
            options.onSelect(row, index, event);
          };
          tr.addEventListener('click', select);
          tr.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              select(event);
            }
          });
        }
        for (const column of fields) {
          const value = row[column.key];
          const text = column.format
            ? column.format(value, row)
            : value == null
              ? '—'
              : typeof value === 'number'
                ? numbers.format(value)
                : String(value);
          tr.append(el('td', column.type === 'number' ? 'atlas-table-number' : '', text));
        }
        body.append(tr);
      }
      if (!ordered.length) {
        const tr = el('tr'),
          cell = el('td', 'atlas-table-empty', 'Нет данных');
        cell.colSpan = fields.length;
        tr.append(cell);
        body.append(tr);
      }
      table.append(colgroup, head, body);
      caption.textContent = 'Строк: ' + rows.length;
    }
    node.update = (nextRows, patch = {}) => {
      if (disposed) return node;
      const next = { ...options, ...patch },
        nextColumns = next.columns || columns;
      if (!Array.isArray(nextColumns) || !nextColumns.length || !Array.isArray(nextRows))
        throw new TypeError('Нужны столбцы и массив строк.');
      const keys = new Set();
      for (const column of nextColumns) {
        if (
          !column ||
          typeof column.key !== 'string' ||
          keys.has(column.key) ||
          typeof column.label !== 'string' ||
          (column.width !== undefined && (!Number.isFinite(column.width) || column.width <= 0)) ||
          (column.format !== undefined && typeof column.format !== 'function')
        )
          throw new TypeError('Нужны уникальные ключи и подписи столбцов.');
        keys.add(column.key);
      }
      for (const row of nextRows) {
        if (!row || typeof row !== 'object')
          throw new TypeError('Строка таблицы должна быть объектом.');
        for (const column of nextColumns)
          if (
            column.type === 'number' &&
            row[column.key] != null &&
            (typeof row[column.key] !== 'number' || !Number.isFinite(row[column.key]))
          )
            throw new TypeError('Числовой столбец должен содержать конечные числа или null.');
      }
      if (next.onSelect !== undefined && typeof next.onSelect !== 'function')
        throw new TypeError('onSelect должен быть функцией.');
      fields = nextColumns.map((column) => ({ ...column }));
      rows = nextRows.map((row) => ({ ...row }));
      options = next;
      if (!keys.has(sortKey)) sortKey = null;
      render();
      return node;
    };
    node.dispose = () => {
      disposed = true;
      initial.signal?.removeEventListener('abort', node.dispose);
      node.replaceChildren();
    };
    node.update(input);
    initial.signal?.addEventListener('abort', node.dispose, { once: true });
    if (initial.signal?.aborted) node.dispose();
    return node;
  }
  const api = Object.freeze({ createTable });
  Object.assign((root.AtlasUI ||= {}), { tables: api });
  if (commonJS) module.exports = api;
})(globalThis);
