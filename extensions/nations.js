/* Nation domain, coloring and its editor. The core knows none of these fields. */
(function (root) {
  'use strict';
  const { uid } = root.AtlasCore, { el, button, field } = root.AtlasUI.dom;
  const EMPTY = { items: {}, owners: {}, groups: {}, groupAssignments: {}, names: {} };
  const validColor = value => /^#[\da-f]{6}$/i.test(value);
  class NationsModel {
    constructor(state) { this.state = state; }
    get data() { return this.state.meta.nations || EMPTY; }
    registerActions(signal) {
      const data = draft => { draft.meta.nations ||= {}; const d = draft.meta.nations; for (const key of Object.keys(EMPTY)) d[key] ||= {}; return d; };
      const register = (type, label, reduce) => this.state.actions.register(type, { label, reduce }, { signal });
      register('nations.save', 'Изменение нации', (draft, p) => { if (!p.id || !String(p.name || '').trim() || !validColor(p.color)) throw new Error('Нужны ID, название и цвет нации.'); data(draft).items[p.id] = { id: p.id, name: String(p.name).trim().slice(0, 80), color: p.color }; });
      register('nations.remove', 'Удаление нации', (draft, p) => { const d = data(draft); delete d.items[p.id]; for (const [id, owner] of Object.entries(d.owners)) if (owner === p.id) delete d.owners[id]; });
      register('nations.assign', 'Назначение территории', (draft, p, { regionIndex }) => { const d = data(draft); if (!Array.isArray(p.ids) || p.ids.some(id => !regionIndex.get(id)) || (p.nationId !== null && !d.items[p.nationId])) throw new Error('Неизвестная провинция или нация.'); for (const id of p.ids) { if (p.nationId) d.owners[id] = p.nationId; else delete d.owners[id]; } });
      register('nations.group.save', 'Изменение группы', (draft, p) => { if (!p.id || !String(p.name || '').trim()) throw new Error('Укажите название группы.'); data(draft).groups[p.id] = { id: p.id, name: String(p.name).trim().slice(0, 80) }; });
      register('nations.group.remove', 'Удаление группы', (draft, p) => { const d = data(draft); delete d.groups[p.id]; for (const [id, group] of Object.entries(d.groupAssignments)) if (group === p.id) delete d.groupAssignments[id]; });
      register('nations.region.set', 'Свойства провинции', (draft, p, { regionIndex }) => { const d = data(draft); if (!regionIndex.get(p.id) || (p.groupId && !d.groups[p.groupId])) throw new Error('Неизвестная провинция или группа.'); if ('name' in p) { const value = String(p.name).trim().slice(0, 80); if (value) d.names[p.id] = value; else delete d.names[p.id]; } if ('groupId' in p) { if (p.groupId) d.groupAssignments[p.id] = p.groupId; else delete d.groupAssignments[p.id]; } });
    }
    dispatch(type, payload, label) { return this.state.dispatch(type, payload, { label, source: 'nations' }); }
    setNation({ id = uid('nation'), name, color }) {
      name = String(name || '').trim().slice(0, 80); if (!name || !validColor(color)) throw new Error('Укажите название и цвет нации.');
      this.dispatch('nations.save', { id, name, color }, 'Нация: ' + name); return id;
    }
    removeNation(id) { this.dispatch('nations.remove', { id }, 'Удаление нации'); }
    assign(ids, nationId) {
      if (nationId && !this.data.items[nationId]) throw new Error('Выберите нацию.');
      if (ids.some(id => !this.state.regions.has(Number(id)))) throw new Error('Провинция не найдена.');
      this.dispatch('nations.assign', { ids: [...new Set(ids.map(Number))], nationId: nationId || null }, nationId ? 'Назначение территории' : 'Освобождение территории');
    }
    setGroup({ id = uid('group'), name }) { name = String(name || '').trim().slice(0, 80); if (!name) throw new Error('Укажите название группы.'); this.dispatch('nations.group.save', { id, name }, 'Группа: ' + name); return id; }
    removeGroup(id) { this.dispatch('nations.group.remove', { id }, 'Удаление группы'); }
    groupMembers(id) { return Object.entries(this.data.groupAssignments).filter(([, group]) => group === id).map(([region]) => Number(region)); }
    assignGroup(id, nationId) { this.assign(this.groupMembers(id), nationId); }
    setRegion(id, { name, groupId } = {}) {
      if (!this.state.regions.has(Number(id))) throw new Error('Провинция не найдена.'); if (groupId && !this.data.groups[groupId]) throw new Error('Группа не найдена.');
      const payload = { id: Number(id) }; if (name !== undefined) payload.name = name; if (groupId !== undefined) payload.groupId = groupId; this.dispatch('nations.region.set', payload, 'Свойства провинции #' + id);
    }
  }
  class NationPainter {
    constructor(ctx, model) {
      this.state = ctx.state; this.ui = ctx.ui; this.model = model; this.layer = ctx.layer({ id: 'ownership', order: 10 }); this.borderLayer = ctx.layer({ id: 'internal-borders', order: 11 });
      this.state.on('change', e => this.update(e), { signal: ctx.signal }); ctx.ui.on('map:ready', () => this.drawAll(), { signal: ctx.signal }); this.drawAll();
    }
    drawRegion(id) {
      const index = this.state.regionIndex, region = index.get(id); if (!region) return;
      const owner = this.model.data.owners[id], nation = this.model.data.items[owner], color = nation?.color, ctx = this.layer.context;
      if (validColor(color)) ctx.fillStyle = color;
      index.forEachRun(id, (start, length) => { const x = start % index.width, y = Math.floor(start / index.width); if (validColor(color)) ctx.fillRect(x, y, length, 1); else ctx.clearRect(x, y, length, 1); });
    }
    drawAll() {
      const index = this.state.regionIndex;
      if (this.borderIndex !== index) {
        const source = document.createElement('canvas'); source.width = index.width; source.height = index.height;
        try { const context = source.getContext('2d', { willReadFrequently: true }); context.drawImage(this.ui.viewport.originalImage, 0, 0); this.borders = new root.AtlasExtensions.NationBorders(index, context.getImageData(0, 0, index.width, index.height).data); this.borderIndex = index; }
        finally { source.width = source.height = 1; }
      }
      this.layer.context.clearRect(0, 0, this.layer.canvas.width, this.layer.canvas.height); for (const id of Object.keys(this.model.data.owners)) this.drawRegion(Number(id));
      this.borderLayer.context.clearRect(0, 0, this.borderLayer.canvas.width, this.borderLayer.canvas.height); this.borders.redraw(this.borderLayer.context, this.model.data);
    }
    update({ before, after }) {
      const old = before.meta.nations || EMPTY, next = after.meta.nations || EMPTY, changed = [];
      for (const id of new Set([...Object.keys(old.owners || {}), ...Object.keys(next.owners || {})])) {
        if (old.owners?.[id] !== next.owners?.[id] || old.items?.[old.owners?.[id]]?.color !== next.items?.[next.owners?.[id]]?.color) { this.drawRegion(Number(id)); changed.push(Number(id)); }
      }
      this.borders?.redraw(this.borderLayer.context, next, changed);
    }
  }
  const definition = {
    id: 'nations', name: 'Нации и территории', description: 'Нации, владельцы, группы и слой раскраски.',
    start(ctx) {
      const { ui, state, signal } = ctx, model = new NationsModel(state); model.registerActions(signal); new NationPainter(ctx, model);
      let activeNation = Object.keys(model.data.items)[0] || null, mode = 'select', selected = ui.viewport.selectedId;
      const protect = fn => (...args) => { try { return fn(...args); } catch (error) { ui.notify(error.message); } };
      const onState = (fn, scope) => { state.on('change', fn, { signal: scope.signal }); state.on('map:loaded', fn, { signal: scope.signal }); };
      const setMode = value => { mode = value; ui.viewport.panOnly = false; ui.refresh(); ui.emit('nations:tool', { mode }); };
      const choose = id => { activeNation = id; setMode('paint'); ui.emit('nations:selection', {}); };
      const paint = id => { if (!id) return; model.assign([id], mode === 'erase' ? null : activeNation); };
      function editNation(id = null) {
        const original = model.data.items[id];
        return ctx.window({ id: 'nation-editor:' + (id || 'new'), title: original ? 'Редактор нации' : 'Новая нация', x: 300, y: 60, width: 285, height: 238, render(pane, scope, tab) {
          const name = document.createElement('input'); name.value = original?.name || ''; name.maxLength = 80; name.placeholder = 'Название нации'; name.setAttribute('aria-label', 'Название нации');
          const color = document.createElement('input'); color.type = 'color'; color.value = original?.color || '#75937d'; color.setAttribute('aria-label', 'Цвет нации');
          pane.append(field('Название', name), field('Цвет', color)); const actions = el('div', 'form-actions');
          actions.append(button('Сохранить', protect(() => { activeNation = model.setNation({ id: id || undefined, name: name.value, color: color.value }); setMode('paint'); tab.close(); }), { className: 'accent' }));
          if (id) { let armed = false; const remove = button('Удалить', () => { if (!armed) { armed = true; remove.textContent = 'Удалить и освободить земли?'; return; } model.removeNation(id); tab.close(); }); actions.append(remove); }
          pane.append(actions); name.focus();
        } });
      }
      function editGroup(id = null) {
        const original = model.data.groups[id];
        return ctx.window({ id: 'group-editor:' + (id || 'new'), title: original ? 'Редактор группы' : 'Новая группа', x: 300, y: 305, width: 285, height: 180, render(pane, scope, tab) {
          const name = document.createElement('input'); name.value = original?.name || ''; name.maxLength = 80; name.setAttribute('aria-label', 'Название группы'); pane.append(field('Название группы', name));
          const row = el('div', 'form-actions'); row.append(button('Сохранить', protect(() => { const groupId = model.setGroup({ id: id || undefined, name: name.value }); if (!id && selected) model.setRegion(selected, { groupId }); tab.close(); }), { className: 'accent' }));
          if (id) { let armed = false; const remove = button('Удалить', () => { if (!armed) { armed = true; remove.textContent = 'Подтвердить удаление'; return; } model.removeGroup(id); tab.close(); }); row.append(remove); }
          pane.append(row); name.focus();
        } });
      }
      function openNations() {
        return ctx.window({ id: 'list', title: 'Нации', x: 14, y: 18, width: 260, height: 355, render(pane, scope) {
          const draw = () => {
            if (!model.data.items[activeNation]) activeNation = Object.keys(model.data.items)[0] || null;
            pane.replaceChildren(); const tools = el('div', 'tool-row');
            for (const [key, label] of [['paint', 'Кисть · B'], ['select', 'Выбор · I'], ['erase', 'Ластик · E']]) tools.append(button(label, () => { setMode(key); draw(); }, { className: mode === key ? 'active' : '' })); pane.append(tools);
            const counts = {}; for (const id of Object.values(model.data.owners)) counts[id] = (counts[id] || 0) + 1;
            for (const nation of Object.values(model.data.items)) {
              const row = el('div', 'nation-row' + (activeNation === nation.id ? ' selected' : '')), chooseButton = button('', () => { choose(nation.id); draw(); }, { className: 'nation-select', title: String(nation.name) });
              const swatch = el('span', 'nation-swatch'); swatch.style.background = validColor(nation.color) ? nation.color : '#888888'; chooseButton.append(swatch, el('span', 'nation-name', String(nation.name)), el('small', 'nation-count', String(counts[nation.id] || 0)));
              row.append(chooseButton, button('✎', () => editNation(nation.id), { title: 'Редактировать ' + nation.name, className: 'icon-button' })); pane.append(row);
            }
            pane.append(button('+ Нация', () => editNation(), { className: 'wide' }));
            const heading = el('div', 'section-line'); heading.append(el('span', '', 'ГРУППЫ ТЕРРИТОРИЙ'), button('+', () => editGroup(), { title: 'Создать группу', className: 'icon-button' })); pane.append(heading);
            for (const group of Object.values(model.data.groups)) {
              const row = el('div', 'group-row'); row.append(button(String(group.name), () => editGroup(group.id), { className: 'group-name' }), el('small', 'muted', String(model.groupMembers(group.id).length)), button('▣', protect(() => model.assignGroup(group.id, activeNation)), { title: 'Закрасить группу ' + group.name, className: 'icon-button' })); pane.append(row);
            }
            if (!Object.keys(model.data.groups).length) pane.append(el('p', 'muted small', 'Группа объединяет несколько провинций.'));
          };
          onState(draw, scope); ui.on('nations:tool', draw, { signal: scope.signal }); ui.on('nations:selection', draw, { signal: scope.signal }); draw();
        } });
      }
      function openInspector() {
        return ctx.window({ id: 'inspector', title: 'Провинция', x: 14, y: 387, width: 260, height: 260, render(pane, scope) {
          const draw = () => {
            const region = state.regionIndex.get(selected); pane.replaceChildren(); if (!region) { pane.append(el('p', 'muted', 'Нажмите на провинцию на карте. Правый клик открывает её контекстное меню.')); return; }
            pane.append(el('div', 'inspector-id', 'ПРОВИНЦИЯ #' + selected)); const name = document.createElement('input'); name.value = model.data.names[selected] || ''; name.placeholder = 'Без названия'; name.setAttribute('aria-label', 'Название провинции'); name.onchange = protect(() => model.setRegion(selected, { name: name.value }));
            const owner = document.createElement('select'); owner.setAttribute('aria-label', 'Владелец провинции'); owner.append(new Option('Свободная территория', '')); for (const nation of Object.values(model.data.items)) owner.append(new Option(String(nation.name), nation.id)); owner.value = model.data.owners[selected] || ''; owner.onchange = protect(() => model.assign([selected], owner.value || null));
            const group = document.createElement('select'); group.setAttribute('aria-label', 'Группа провинции'); group.append(new Option('Без группы', '')); for (const item of Object.values(model.data.groups)) group.append(new Option(String(item.name), item.id)); group.value = model.data.groupAssignments[selected] || ''; group.onchange = protect(() => model.setRegion(selected, { groupId: group.value || null }));
            pane.append(field('Название', name), field('Владелец', owner), field('Группа', group));
            if (group.value) pane.append(button('Назначить всю группу выбранной нации', protect(() => model.assignGroup(group.value, activeNation)), { className: 'wide' }));
            pane.append(el('p', 'muted mono small', region.area.toLocaleString('ru-RU') + ' px · X ' + region.anchor[0] + ' Y ' + region.anchor[1]));
          };
          ctx.ui.input.on('selection:change', e => { selected = e.id; draw(); }, { signal: scope.signal }); onState(draw, scope); draw();
        } });
      }
      ctx.on('selection:change', event => { selected = event.id; });
      ctx.on('province:click', protect(event => { if (event.id && mode !== 'select') paint(event.id); }));
      ctx.on('key', event => { if (event.ctrlKey || event.metaKey || event.altKey) return; const value = { KeyB: 'paint', KeyI: 'select', KeyE: 'erase' }[event.code]; if (value) { event.preventDefault(); setMode(value); } });
      ctx.menu(ui.mainMenu, { id: 'open', path: ['Мир'], label: 'Нации', handler: openNations });
      ctx.menu(ui.mainMenu, { id: 'inspect', path: ['Мир'], label: 'Свойства провинции', handler: openInspector });
      ctx.menu(ui.mainMenu, { id: 'new-nation', path: ['Мир', 'Создать'], label: 'Нация', handler: () => editNation() });
      ctx.menu(ui.mainMenu, { id: 'new-group', path: ['Мир', 'Создать'], label: 'Группа провинций', handler: () => editGroup() });
      ctx.menu(ui.tileMenu, { id: 'assign', path: ['Владелец'], label: 'Назначить выбранной нации', when: e => !!e.id, enabled: () => !!model.data.items[activeNation], handler: e => model.assign([e.id], activeNation) });
      ctx.menu(ui.tileMenu, { id: 'release', path: ['Владелец'], label: 'Освободить провинцию', when: e => !!e.id, handler: e => model.assign([e.id], null) });
      ctx.menu(ui.tileMenu, { id: 'inspect', label: 'Свойства провинции', when: e => !!e.id, handler: e => { ui.viewport.select(e.id); openInspector(); } });
      ui.registerTooltip('nations', e => { const d = model.data, owner = d.items[d.owners[e.id]]; return (d.names[e.id] ? d.names[e.id] + ' · ' : '') + (owner?.name || 'Свободная территория'); }, { signal });
      ui.registerStatus('nations', () => Object.keys(model.data.owners).length + ' назначено · ' + (mode === 'select' ? 'Выбор' : mode === 'erase' ? 'Ластик' : 'Кисть: ' + (model.data.items[activeNation]?.name || 'выберите нацию')), { signal });
      openNations(); openInspector();
    }
  };
  Object.assign(root.AtlasExtensions ||= {}, { NationsModel, NationPainter, nations: definition });
})(globalThis);
