/* Optional resource UI, pixel markers and an interpreter over generic entries. */
(function (root) {
  'use strict';
  const { el, button, field } = root.AtlasUI.dom, { uid } = root.AtlasCore;
  const { ResourceModel, readResourceEntry, RESOURCE_ACTIVITIES: activities, RESOURCE_BONUSES: bonuses } = root.AtlasExtensions;
  const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
  const format = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  function drawResourceMarkers(context, regions, tiles) {
    for (const [key, tile] of Object.entries(tiles || {})) {
      const region = regions.get(Number(key)); if (!region) continue;
      const entries = Object.values(tile.entries || {}).filter(e => e.source === 'resources'), hasProduction = entries.some(e => e.kind === 'production'), hasPoint = entries.some(e => e.kind === 'resource-point');
      const [cx, cy] = region.anchor;
      if (hasProduction) {
        const x = cx - (hasPoint ? 9 : 0), y = cy; context.fillStyle = '#101c22'; context.fillRect(x - 7, y - 4, 15, 11); context.fillRect(x - 6, y - 9, 5, 6);
        context.fillStyle = '#e4c46f'; context.fillRect(x - 5, y - 2, 11, 7); context.fillRect(x - 4, y - 7, 2, 5); context.fillStyle = '#182a32'; context.fillRect(x - 3, y, 2, 2); context.fillRect(x + 2, y, 2, 2);
      }
      if (hasPoint) {
        const x = cx + (hasProduction ? 9 : 0), y = cy; context.fillStyle = '#101c22';
        for (let d = -7; d <= 7; d++) { const w = 7 - Math.abs(d); context.fillRect(x - w, y + d, w * 2 + 1, 1); }
        context.fillStyle = '#71d0c4'; for (let d = -5; d <= 5; d++) { const w = 5 - Math.abs(d); context.fillRect(x - w, y + d, w * 2 + 1, 1); }
      }
    }
  }
  const definition = {
    id: 'resources', name: 'Ресурсы и производства', description: 'Рецепты, снабжение по приоритету, чистый выпуск и баффы.',
    start(ctx) {
      const { state, ui, signal } = ctx, model = new ResourceModel(state); model.registerStatistics(signal); let selected = ui.viewport.selectedId;
      const protect = fn => (...args) => { try { return fn(...args); } catch (e) { ui.notify(e.message); } };
      const openData = (event, payload) => { if (!ui.extensions.isEnabled('metadata')) { ui.notify('Включите модуль «Метаданные и статистика».'); return; } ui.emit(event, payload); };
      const markers = ctx.overlay({ id: 'markers', title: 'Ресурсы и производства', order: 20 });
      const drawMarkers = () => { markers.context.clearRect(0, 0, markers.canvas.width, markers.canvas.height); drawResourceMarkers(markers.context, state.regions, state.meta.tiles); };
      state.on('change', drawMarkers, { signal }); ui.on('map:ready', drawMarkers, { signal }); drawMarkers();
      function edit(regionId, kind = 'production', original = null) {
        let initial; try { initial = original && readResourceEntry(original); } catch (e) { ui.notify('Исправьте некорректные статы в метаданных тайла. ' + e.message); return; }
        const point = kind === 'resource-point', initialMap = state.map.id;
        return ctx.window({ id: 'edit:' + regionId + ':' + (original?.id || kind), title: point ? 'Ресурсная точка' : 'Производство', x: 350, y: 35, width: 370, height: point ? 475 : 540, render(pane, scope, tab) {
          const form = el('form'), title = document.createElement('input'), description = document.createElement('textarea'), resource = document.createElement('input'), activity = document.createElement('select'), unit = document.createElement('input');
          title.value = initial?.title || (point ? 'Новая ресурсная точка' : 'Новое производство'); title.required = true; title.maxLength = 100; title.setAttribute('aria-label', 'Название объекта');
          description.value = initial?.description || ''; description.rows = 2; description.maxLength = 8000; description.setAttribute('aria-label', 'Описание объекта');
          resource.value = initial?.resource === '*' ? '' : initial?.resource || ''; resource.placeholder = point ? 'Пусто — все ресурсы' : 'Например, железо'; resource.required = !point; resource.maxLength = 80; resource.setAttribute('aria-label', 'Ресурс или продукт');
          const examples = document.createElement('datalist'); examples.id = uid('goods'); for (const text of ['Железо', 'Уголь', 'Нефть', 'Сталь', 'Энергия', 'Продовольствие']) examples.append(new Option(text)); resource.setAttribute('list', examples.id);
          if (point) activity.append(new Option('Все виды', '*')); for (const [id, label] of Object.entries(activities)) activity.append(new Option(label, id)); activity.value = initial?.activity || (point ? '*' : 'extraction'); activity.setAttribute('aria-label', 'Вид производства');
          unit.value = initial?.unit === '*' ? '' : initial?.unit || (point ? '' : 'ед./ход'); unit.placeholder = point ? 'Пусто — любые единицы' : 'ед./ход'; unit.maxLength = 40; unit.setAttribute('aria-label', 'Единица выпуска');
          form.append(el('p', 'muted small', 'Провинция #' + regionId), field('Название', title), field('Описание', description), field(point ? 'Фильтр' : 'Ресурс', resource), examples, field('Вид', activity), field('Единицы', unit));
          let rate, priority; const buffRows = [], inputRows = [];
          if (!point) {
            rate = document.createElement('input'); rate.type = 'number'; rate.min = 0; rate.step = 'any'; rate.value = initial?.baseOutput ?? 10; rate.required = true; rate.setAttribute('aria-label', 'Базовый выпуск');
            priority = document.createElement('input'); priority.type = 'number'; priority.min = 0; priority.max = 1000000; priority.step = 1; priority.value = initial?.priority ?? 0; priority.required = true; priority.setAttribute('aria-label', 'Приоритет снабжения');
            form.append(field('Выпуск', rate), field('Приоритет', priority), el('p', 'muted small', 'Меньшее число — раньше получает сырьё. При равенстве — номер провинции и порядок добавления.'));
            const inputs = el('div'); let inputSequence = 0;
            const addInput = (value = {}) => {
              const n = ++inputSequence, row = el('div', 'resource-input-row'), name = document.createElement('input'), amount = document.createElement('input'), inputUnit = document.createElement('input');
              name.value = value.resource || ''; name.required = true; name.maxLength = 80; name.placeholder = 'Сырьё'; name.setAttribute('list', examples.id); name.setAttribute('aria-label', 'Расход: ресурс ' + n);
              amount.type = 'number'; amount.min = 0; amount.step = 'any'; amount.value = value.amount ?? 1; amount.required = true; amount.setAttribute('aria-label', 'Расход: количество ' + n);
              inputUnit.value = value.unit || unit.value || 'ед./ход'; inputUnit.required = true; inputUnit.maxLength = 40; inputUnit.setAttribute('aria-label', 'Расход: единица ' + n);
              const record = { name, amount, unit: inputUnit }, controls = el('div', 'resource-input-controls'); controls.append(amount, inputUnit, button('×', () => { row.remove(); inputRows.splice(inputRows.indexOf(record), 1); }, { title: 'Удалить расход ' + n, className: 'icon-button' })); row.append(name, controls); inputs.append(row); inputRows.push(record);
            };
            for (const input of initial?.inputs || []) addInput(input);
            form.append(el('div', 'section-line', 'РАСХОД ПРИ БАЗОВОМ ВЫПУСКЕ'), inputs, button('+ Сырьё', () => addInput(), { className: 'small' }), el('p', 'muted small', 'Расход растёт вместе с выпуском и баффами. Если сырья мало, предприятие работает частично. Без расходов оно производит ресурс самостоятельно.'));
          }
          else {
            form.append(el('div', 'section-line', 'БАФФЫ · 4 → 2 → 3 → 1')); const rows = el('div');
            const addBuff = (buff = { type: 'province-percent', value: 50 }) => {
              const row = el('div', 'resource-buff-row'), type = document.createElement('select'), value = document.createElement('input');
              for (const [id, spec] of Object.entries(bonuses)) type.append(new Option(spec.label, id)); type.value = buff.type; type.setAttribute('aria-label', 'Тип баффа');
              value.type = 'number'; value.min = 0; value.step = 'any'; value.value = buff.value; value.required = true; value.setAttribute('aria-label', 'Величина баффа');
              const inputResource = document.createElement('input'), inputUnit = document.createElement('input'), filters = el('div', 'resource-input-controls');
              inputResource.value = buff.inputResource && buff.inputResource !== '*' ? buff.inputResource : ''; inputResource.placeholder = 'Любое сырьё'; inputResource.maxLength = 80; inputResource.setAttribute('aria-label', 'Бафф: сырьё'); inputResource.setAttribute('list', examples.id);
              inputUnit.value = buff.inputUnit && buff.inputUnit !== '*' ? buff.inputUnit : ''; inputUnit.placeholder = 'Любые единицы'; inputUnit.maxLength = 40; inputUnit.setAttribute('aria-label', 'Бафф: единица сырья');
              filters.append(inputResource, inputUnit); const updateFilters = () => { filters.hidden = !bonuses[type.value].efficiency; }; type.onchange = updateFilters; updateFilters();
              const item = { type, value, inputResource, inputUnit }, controls = el('div', 'metadata-stat-controls'); controls.append(value, button('×', () => { row.remove(); buffRows.splice(buffRows.indexOf(item), 1); }, { title: 'Удалить бафф', className: 'icon-button' }));
              row.append(type, controls, filters); rows.append(row); buffRows.push(item);
            };
            for (const buff of initial?.bonuses || [{ type: 'province-percent', value: 50 }]) addBuff(buff);
            form.append(rows, button('+ Бафф', () => addBuff(), { className: 'small' }), el('p', 'muted small', 'Фильтры сверху задают продукт предприятия. У эффективности можно отдельно выбрать сырьё. Численное снижение применяется к расходу базового рецепта, затем масштабируется выпуском. Снижения одного типа в процентах складываются до 100%. Общие баффы действуют внутри выбранного набора.'));
          }
          const save = button('Сохранить объект', () => {}, { className: 'accent wide' }); save.type = 'submit'; form.append(save);
          form.onsubmit = protect(event => { event.preventDefault(); model.save(regionId, { id: original?.id, kind, title: title.value, description: description.value, resource: resource.value, activity: activity.value, unit: unit.value, baseOutput: rate ? Number(rate.value) : undefined, priority: priority ? Number(priority.value) : undefined, inputs: inputRows.map(row => ({ resource: row.name.value, unit: row.unit.value, amount: Number(row.amount.value) })), bonuses: buffRows.map(b => ({ type: b.type.value, value: Number(b.value.value), ...(bonuses[b.type.value].efficiency ? { inputResource: b.inputResource.value.trim() || '*', inputUnit: b.inputUnit.value.trim() || '*' } : {}) })) }); tab.close(); });
          state.on('map:loaded', () => { if (state.map.id !== initialMap) tab.close(); }, { signal: scope.signal }); pane.append(form); title.focus();
        } });
      }
      function open(regionId = selected) {
        if (regionId && state.regions.has(regionId)) { selected = regionId; ui.viewport.select(regionId); }
        return ctx.window({ id: 'objects', title: 'Ресурсы и производства', x: 295, y: 55, width: 350, height: 400, render(pane, scope, tab) {
          const expanded = new Map();
          const draw = () => {
            pane.replaceChildren(); if (!state.regions.has(selected)) { pane.append(el('p', 'muted', 'Выберите провинцию на карте.')); return; }
            const id = selected; tab.setTitle('Объекты #' + id); pane.append(el('div', 'inspector-id', 'ПРОВИНЦИЯ #' + id));
            const tools = el('div', 'tool-row'); tools.append(button('+ Производство', () => edit(id)), button('+ Ресурсная точка', () => edit(id, 'resource-point'))); pane.append(tools);
            pane.append(button('Статистика провинции', () => openData('statistics:open', { regionIds: [id], title: 'Провинция #' + id }), { className: 'wide small' }));
            for (const entry of model.list(id)) {
              const key = id + ':' + entry.id, group = createDataGroup(entry.title, { id: entry.id, open: expanded.has(key) ? expanded.get(key) : true, onToggle: open => expanded.set(key, open) }), card = group.body;
              try {
                const value = readResourceEntry(entry); card.append(createDataRow('Ресурс', value.resource === '*' ? 'Все ресурсы' : value.resource), createDataRow('Вид', activities[value.activity] || 'Все виды'));
                if (value.kind === 'production') { card.append(createDataRow('Базовый выпуск', format(value.baseOutput) + ' ' + value.unit), createDataRow('Приоритет снабжения', String(value.priority))); for (const input of value.inputs) card.append(createDataRow('Расход: ' + input.resource, format(input.amount) + ' ' + input.unit)); }
                else for (const buff of value.bonuses) card.append(createDataRow(bonuses[buff.type].label, (bonuses[buff.type].efficiency ? '−' : '+') + format(buff.value) + (bonuses[buff.type].percent ? '%' : '') + (buff.inputResource && buff.inputResource !== '*' ? ' · ' + buff.inputResource : '') + (buff.inputUnit && buff.inputUnit !== '*' ? ' · ' + buff.inputUnit : '')));
              } catch (e) { card.append(el('p', 'form-error', e.message)); }
              if (entry.description) card.append(el('p', 'metadata-description', entry.description)); const actions = el('div', 'form-actions');
              actions.append(button('Изменить', () => edit(id, entry.kind, entry), { className: 'small' }), button('Метаданные', () => openData('metadata:open', { regionId: id }), { className: 'small' }), button('Удалить', protect(() => model.remove(id, entry.id)), { className: 'small' })); card.append(actions); pane.append(group.element);
            }
            if (!model.list(id).length) pane.append(el('p', 'muted', 'Объектов пока нет. Ресурсная точка усиливает подходящие производства, своего выпуска у неё нет.'));
            pane.append(el('p', 'muted small', 'На карте: золотой завод — производство, бирюзовый ромб — ресурсная точка.'));
          };
          const update = e => { selected = e.id; draw(); }; tab.onRegionClick(update);
          ui.input.on('selection:change', e => { if (!e.fromClick) update(e); }, { signal: scope.signal }); state.on('change', draw, { signal: scope.signal }); state.on('map:loaded', draw, { signal: scope.signal }); draw();
        } });
      }
      ctx.on('selection:change', e => { selected = e.id; });
      ctx.menu(ui.mainMenu, { id: 'open', path: ['Ресурсы'], label: 'Объекты провинции', handler: () => open() });
      ctx.menu(ui.mainMenu, { id: 'production', path: ['Ресурсы'], label: 'Добавить производство', enabled: () => !!selected, handler: () => edit(selected) });
      ctx.menu(ui.mainMenu, { id: 'point', path: ['Ресурсы'], label: 'Добавить ресурсную точку', enabled: () => !!selected, handler: () => edit(selected, 'resource-point') });
      ctx.menu(ui.mainMenu, { id: 'statistics', path: ['Ресурсы'], label: 'Статистика всей карты', handler: () => openData('statistics:open', { regionIds: [...state.regions.keys()], title: 'Вся карта' }) });
      ctx.menu(ui.tileMenu, { id: 'open', path: ['Провинция', 'Ресурсы'], label: 'Объекты', order: 104, handler: id => open(id) });
      ctx.menu(ui.tileMenu, { id: 'production', path: ['Провинция', 'Ресурсы'], label: 'Добавить производство', order: 105, handler: id => edit(id) });
      ctx.menu(ui.tileMenu, { id: 'point', path: ['Провинция', 'Ресурсы'], label: 'Добавить ресурсную точку', order: 106, handler: id => edit(id, 'resource-point') });
      ui.registerTooltip('resources', e => { const entries = model.list(e.id); return entries.length ? 'Производств: ' + entries.filter(e => e.kind === 'production').length + ' · Точек: ' + entries.filter(e => e.kind === 'resource-point').length : ''; }, { signal });
    }
  };
  Object.assign(root.AtlasExtensions ||= {}, { resources: definition, drawResourceMarkers });
})(globalThis);
