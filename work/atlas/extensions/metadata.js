/* Generic entry editor and statistic viewer. Other modules communicate by events. */
(function (root) {
  'use strict';
  const { el, button, field } = root.AtlasUI.dom;
  const { createDataRow, createDataGroup, renderDataTree } = root.AtlasUI.dataView;
  const format = value => typeof value === 'number' ? value.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) : typeof value === 'string' ? value : JSON.stringify(value);
  function drawRegionSet(context, index, ids) {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.fillStyle = 'rgba(67,211,228,.23)';
    for (const id of ids) index.forEachRun(id, (start, length) => context.fillRect(start % index.width, Math.floor(start / index.width), length, 1));
    context.fillStyle = '#76e4ef';
    for (const id of ids) index.forEachRun(id, (start, length) => { const x = start % index.width, y = Math.floor(start / index.width); context.fillRect(x, y, 1, 1); if (length > 1) context.fillRect(x + length - 1, y, 1, 1); });
  }
  function renderBlocks(pane, report, expanded = new Map()) {
    pane.classList.add('atlas-data-scope');
    renderDataTree(pane, report.tree, { expanded, formatValue: node => format(node.value) + (node.unit ? ' ' + node.unit : '') });
    for (const error of report.errors) pane.append(el('p', 'form-error', error.title + ': ' + error.message));
  }
  const definition = {
    id: 'metadata', name: 'Метаданные и статистика', description: 'Записи тайлов, общие статы и отчёты по наборам регионов.',
    start(ctx) {
      const { state, ui, signal } = ctx; let selected = ui.viewport.selectedId, mode = 'current', setTitle = '', mapId = state.map.id; const chosen = new Set();
      let showChosen = true;
      const highlight = ctx.layer({ id: 'chosen', order: 80, exportable: false });
      const drawChosen = () => drawRegionSet(highlight.context, state.regionIndex, showChosen ? chosen : []);
      const refreshSet = () => { drawChosen(); ui.emit('metadata:refresh', {}); ui.refresh(); };
      let collectListener = null;
      const collectRegions = () => { mode = 'set'; showChosen = true; openStatistics(); collectListener.activate(); refreshSet(); };
      const addRegions = ids => { for (const id of ids) if (state.regions.has(id)) chosen.add(id); mode = 'set'; setTitle = ''; collectRegions(); };
      ui.regionClicks.on('change', refreshSet, { signal });
      ui.on('map:ready', drawChosen, { signal });
      const protect = fn => (...args) => { try { return fn(...args); } catch (e) { ui.notify(e.message); } };
      const watch = (fn, scope) => { state.on('change', fn, { signal: scope.signal }); state.on('map:loaded', fn, { signal: scope.signal }); ui.on('metadata:refresh', fn, { signal: scope.signal }); };
      function edit(regionId, original = null) {
        const initialMap = state.map.id;
        return ctx.window({ id: 'edit:' + regionId + ':' + (original?.id || 'new'), title: original ? 'Изменить запись' : 'Новая запись', x: 350, y: 65, width: 365, height: 430, render(pane, scope, tab) {
          pane.classList.add('atlas-data-scope');
          const form = el('form'), title = document.createElement('input'), description = document.createElement('textarea');
          title.value = original?.title || ''; title.maxLength = 100; title.required = true; title.setAttribute('aria-label', 'Название записи'); description.value = original?.description || ''; description.maxLength = 8000; description.rows = 3; description.setAttribute('aria-label', 'Описание записи');
          form.append(field('Название', title), field('Описание', description), el('div', 'section-line', 'СТАТЫ'));
          const rows = el('div'), values = []; let sequence = 0;
          function addStat(stat = '', value = 0) {
            const number = ++sequence, node = el('div', 'metadata-stat-row'), key = document.createElement('input'), type = document.createElement('select'), controls = el('div', 'metadata-stat-controls');
            key.value = stat; key.placeholder = 'Ключ стата'; key.setAttribute('aria-label', 'Ключ стата ' + number);
            for (const [id, label] of [['number', 'Число'], ['string', 'Текст'], ['boolean', 'Да / нет'], ['json', 'Данные JSON']]) type.append(new Option(label, id));
            type.value = typeof value === 'number' ? 'number' : typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : 'json'; type.setAttribute('aria-label', 'Тип стата ' + number);
            let input;
            const inputForType = () => {
              const previous = input ? input.type === 'checkbox' ? input.checked : input.value : value; input?.remove(); input = document.createElement('input'); input.setAttribute('aria-label', 'Значение стата ' + number);
              if (type.value === 'boolean') { input.type = 'checkbox'; input.checked = previous === true || previous === 'true'; }
              else { input.type = type.value === 'number' ? 'number' : 'text'; input.step = 'any'; input.value = typeof previous === 'object' ? JSON.stringify(previous) : String(previous); }
              controls.insertBefore(input, remove);
            };
            const record = { key, type, read: () => { if (type.value === 'boolean') return input.checked; if (type.value === 'json') return JSON.parse(input.value); if (type.value === 'number') { const n = Number(input.value); if (!input.value.trim() || !Number.isFinite(n)) throw new Error('Укажите конечное число для стата ' + key.value); return n; } return input.value; } };
            const remove = button('×', () => { node.remove(); values.splice(values.indexOf(record), 1); }, { title: 'Удалить стат ' + number, className: 'icon-button' });
            controls.append(type, remove); inputForType(); type.onchange = inputForType; node.append(key, controls); rows.append(node); values.push(record);
          }
          for (const [stat, value] of Object.entries(original?.stats || {})) addStat(stat, value);
          form.append(rows, button('+ Стат', () => addStat(), { className: 'small' }), el('p', 'muted small', 'Одинаковые ключи обозначают один стат. Числа суммируются, если подключённый сборщик не задаёт свой расчёт.'));
          const save = button('Сохранить запись', () => {}, { className: 'accent wide' }); save.type = 'submit'; form.append(save);
          form.onsubmit = protect(event => {
            event.preventDefault(); const stats = {};
            for (const row of values) { const key = row.key.value.trim(); if (!key || Object.hasOwn(stats, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Ключи статов должны быть непустыми, безопасными и уникальными.'); stats[key] = row.read(); }
            state.tileMetadata.save(regionId, { id: original?.id, title: title.value, description: description.value, stats, source: original?.source || 'user', kind: original?.kind || 'note' }); tab.close();
          });
          state.on('map:loaded', () => { if (state.map.id !== initialMap) tab.close(); }, { signal: scope.signal }); pane.append(form); title.focus();
        } });
      }
      function openMetadata(id = selected) {
        if (id && state.regions.has(id)) { selected = id; ui.viewport.select(id); }
        return ctx.window({ id: 'entries', title: 'Метаданные тайла', x: 295, y: 35, width: 345, height: 390, render(pane, scope, tab) {
          pane.classList.add('atlas-data-scope'); const expanded = new Map();
          const draw = () => {
            pane.replaceChildren(); if (!state.regions.has(selected)) { pane.append(el('p', 'muted', 'Выберите провинцию на карте.')); return; }
            const id = selected; tab.setTitle('Метаданные #' + id); pane.append(el('div', 'inspector-id', 'ТАЙЛ #' + id));
            const tools = el('div', 'tool-row'); tools.append(button('+ Запись', () => edit(id)), button('В набор', () => addRegions([id]), { title: 'Добавить тайл в набор статистики' }), button('Статистика', () => openStatistics())); pane.append(tools);
            const entries = state.tileMetadata.list(id);
            for (const entry of entries) {
              const key = id + ':' + entry.id, group = createDataGroup(entry.title, { id: entry.id, open: expanded.has(key) ? expanded.get(key) : true, onToggle: open => expanded.set(key, open) });
              group.element.classList.add('metadata-entry'); if (entry.description) group.body.append(el('p', 'metadata-description', entry.description));
              for (const [stat, value] of Object.entries(entry.stats)) group.body.append(createDataRow(stat, format(value), { id: stat }));
              const row = el('div', 'form-actions'); row.append(button('Изменить', () => edit(id, entry), { className: 'small' }), button('Удалить', protect(() => state.tileMetadata.remove(id, entry.id)), { className: 'small' })); group.body.append(row); pane.append(group.element);
            }
            if (!entries.length) pane.append(el('p', 'muted', 'У этого тайла пока нет записей.'));
          };
          const update = e => { selected = e.id; draw(); }; tab.onRegionClick(update);
          ui.input.on('selection:change', e => { if (!e.fromClick) update(e); }, { signal: scope.signal }); watch(draw, scope); draw();
        } });
      }
      function openStatistics(ids = null, title = '') {
        if (ids) { chosen.clear(); for (const id of ids) if (state.regions.has(id)) chosen.add(id); mode = 'set'; setTitle = title; }
        const handle = ctx.window({ id: 'statistics', title: 'Статистика регионов', x: 650, y: 35, width: 350, height: 420, render(pane, scope, tab) {
          const collector = tab.onRegionClick(event => {
            if (!state.regions.has(event.id)) return;
            if (chosen.has(event.id)) chosen.delete(event.id); else chosen.add(event.id);
            mode = 'set'; setTitle = ''; refreshSet();
          }, { id: 'metadata:collect', mode: 'active', label: 'Набор регионов', cursor: 'copy' });
          collectListener = collector; scope.defer(() => { if (collectListener === collector) collectListener = null; });
          pane.classList.add('atlas-data-scope'); const expanded = new Map();
          const draw = () => {
            pane.replaceChildren(); const choose = document.createElement('select'); choose.setAttribute('aria-label', 'Область статистики');
            for (const [id, label] of [['current', 'Текущий тайл'], ['set', setTitle || 'Выбранный набор'], ['all', 'Вся карта']]) choose.append(new Option(label, id)); choose.value = mode; choose.onchange = () => { mode = choose.value; draw(); }; pane.append(field('Область', choose));
            const collecting = collector.selected, collect = button('Набор на карте', () => { if (collector.selected) collector.deactivate(); else collectRegions(); }, { className: collecting ? 'set-active' : '', title: 'Включить или выключить выбор набора кликами по карте' }); collect.setAttribute('aria-pressed', String(collecting));
            const tools = el('div', 'tool-row set-tools'), add = button('Добавить тайл', () => addRegions([selected])), clear = button('Очистить набор', () => { chosen.clear(); setTitle = ''; mode = 'set'; refreshSet(); }); add.disabled = !state.regions.has(selected); tools.append(collect, add, clear); pane.append(tools);
            const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = showChosen; visible.setAttribute('aria-label', 'Подсветка набора'); visible.onchange = () => { showChosen = visible.checked; drawChosen(); }; pane.append(field('Подсветка набора', visible), el('p', 'set-count', 'В наборе: ' + chosen.size + ' провинций'));
            if (collecting) pane.append(el('p', 'set-tool-help', 'Клик — добавить или убрать провинцию. Кнопка «Набор на карте» выключает выбор. Закрытие окна тоже отключает его. Территории целой нации добавляются кнопкой ⊞ в списке наций.'));
            const ids = mode === 'all' ? [...state.regions.keys()] : mode === 'current' ? state.regions.has(selected) ? [selected] : [] : [...chosen].filter(id => state.regions.has(id));
            if (mode === 'set') { const chips = el('div', 'region-chips'); for (const id of ids.slice(0, 50)) { const chip = button('#' + id + ' ×', () => { chosen.delete(id); refreshSet(); }, { title: 'Убрать #' + id + ' из набора', className: 'small' }); chips.append(chip); } if (ids.length > 50) chips.append(el('span', 'muted small', 'и ещё ' + (ids.length - 50) + '; в расчёте участвует весь набор')); pane.append(chips); }
            if (!ids.length) pane.append(el('p', 'muted', 'Выберите тайл или добавьте регионы в набор.'));
            try { renderBlocks(pane, state.statistics.collect(ids), expanded); } catch (e) { pane.append(el('p', 'form-error', e.message)); }
          };
          const update = e => { selected = e.id; draw(); }; tab.onRegionClick(update);
          ui.input.on('selection:change', e => { if (!e.fromClick) update(e); }, { signal: scope.signal }); state.statistics.on('change', draw, { signal: scope.signal }); watch(draw, scope); draw();
        } }); refreshSet(); return handle;
      }
      ctx.on('selection:change', e => { selected = e.id; });
      state.on('map:loaded', () => { if (state.map.id !== mapId) { mapId = state.map.id; selected = null; chosen.clear(); setTitle = ''; mode = 'set'; refreshSet(); } }, { signal });
      ui.on('metadata:open', e => openMetadata(e.regionId), { signal }); ui.on('statistics:open', e => openStatistics(e.regionIds, e.title), { signal });
      ui.on('statistics:add-regions', e => addRegions(e.regionIds), { signal });
      ctx.menu(ui.mainMenu, { id: 'entries', path: ['Данные'], label: 'Метаданные тайла', handler: () => openMetadata() });
      ctx.menu(ui.mainMenu, { id: 'statistics', path: ['Данные'], label: 'Статистика регионов', handler: () => openStatistics() });
      ctx.menu(ui.mainMenu, { id: 'collect', path: ['Данные'], label: 'Набор регионов на карте', handler: collectRegions });
      ctx.menu(ui.tileMenu, { id: 'entries', path: ['Данные'], label: 'Метаданные тайла', when: e => !!e.id, handler: e => openMetadata(e.id) });
      ctx.menu(ui.tileMenu, { id: 'add', path: ['Данные'], label: 'Добавить запись', when: e => !!e.id, handler: e => edit(e.id) });
      ctx.menu(ui.tileMenu, { id: 'statistics', path: ['Данные'], label: 'Статистика тайла', when: e => !!e.id, handler: e => { selected = e.id; mode = 'current'; openStatistics(); } });
      ctx.menu(ui.tileMenu, { id: 'set', path: ['Данные'], label: 'В набор статистики', when: e => !!e.id, handler: e => addRegions([e.id]) });
      ui.registerStatus('metadata:set', () => chosen.size || ui.regionClicks.activeId === 'metadata:collect' ? 'В наборе: ' + chosen.size : '', { signal });
      ui.registerTooltip('metadata', e => { const entries = state.tileMetadata.list(e.id); return entries.length ? 'Записей: ' + entries.length + ' · ' + entries.slice(0, 2).map(e => e.title).join(', ') : ''; }, { signal });
    }
  };
  Object.assign(root.AtlasExtensions ||= {}, { metadata: definition, renderStatisticBlocks: renderBlocks, drawRegionSet });
})(globalThis);
