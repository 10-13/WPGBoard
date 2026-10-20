/* Nation domain, coloring and its editor. The core knows none of these fields. */
(function (root) {
  'use strict';
  const { equal } = root.AtlasCore,
    { el, button, field } = root.AtlasUI.dom;
  const { NationsModel, EMPTY_NATIONS: EMPTY, validNationColor: validColor } = root.AtlasExtensions;
  const { createDataRow } = root.AtlasUI.dataView;
  class NationPainter {
    constructor(ctx, model) {
      this.state = ctx.state;
      this.ui = ctx.ui;
      this.model = model;
      this.layer = ctx.overlay({ id: 'ownership', title: 'Владения наций', order: 10 });
      this.borderLayer = ctx.overlay({ id: 'borders', title: 'Границы наций', order: 11 });
      this.state.on('change', (e) => this.update(e), { signal: ctx.signal });
      ctx.ui.on('map:ready', () => this.drawAll(), { signal: ctx.signal });
      this.drawAll();
    }
    drawRegion(id) {
      const index = this.state.regionIndex,
        region = index.get(id);
      if (!region) return;
      const owner = this.model.data.owners[id],
        nation = this.model.data.items[owner],
        color = nation?.color,
        ctx = this.layer.context;
      if (validColor(color)) ctx.fillStyle = color;
      index.forEachRun(id, (start, length) => {
        const x = start % index.width,
          y = Math.floor(start / index.width);
        if (validColor(color)) ctx.fillRect(x, y, length, 1);
        else ctx.clearRect(x, y, length, 1);
      });
    }
    drawAll() {
      const index = this.state.regionIndex;
      if (this.borderIndex !== index) {
        const source = document.createElement('canvas');
        source.width = index.width;
        source.height = index.height;
        try {
          const context = source.getContext('2d', { willReadFrequently: true });
          context.drawImage(this.ui.viewport.originalImage, 0, 0);
          this.borders = new root.AtlasExtensions.NationBorders(
            index,
            context.getImageData(0, 0, index.width, index.height).data,
          );
          this.borderIndex = index;
        } finally {
          source.width = source.height = 1;
        }
      }
      this.layer.context.clearRect(0, 0, this.layer.canvas.width, this.layer.canvas.height);
      for (const id of Object.keys(this.model.data.owners)) this.drawRegion(Number(id));
      this.borderLayer.context.clearRect(
        0,
        0,
        this.borderLayer.canvas.width,
        this.borderLayer.canvas.height,
      );
      this.borders.redraw(this.borderLayer.context, this.model.data);
    }
    update({ before, after }) {
      const old = before.meta.nations || EMPTY,
        next = after.meta.nations || EMPTY,
        changed = [];
      for (const id of new Set([
        ...Object.keys(old.owners || {}),
        ...Object.keys(next.owners || {}),
      ])) {
        if (
          old.owners?.[id] !== next.owners?.[id] ||
          old.items?.[old.owners?.[id]]?.color !== next.items?.[next.owners?.[id]]?.color
        ) {
          this.drawRegion(Number(id));
          changed.push(Number(id));
        }
      }
      this.borders?.redraw(
        this.borderLayer.context,
        next,
        equal(old.wars || {}, next.wars || {}) ? changed : null,
      );
    }
  }
  const definition = {
    id: 'nations',
    name: 'Нации и территории',
    description: 'Нации, территории, войны, информация и раскраска границ.',
    start(ctx) {
      const { ui, state, signal } = ctx,
        model = new NationsModel(state);
      model.registerActions(signal);
      new NationPainter(ctx, model);
      let activeNation = Object.keys(model.data.items)[0] || null,
        selected = ui.viewport.selectedId;
      const protect =
        (fn) =>
        (...args) => {
          try {
            return fn(...args);
          } catch (error) {
            ui.notify(error.message);
          }
        };
      const onState = (fn, scope) => {
        state.on('change', fn, { signal: scope.signal });
        state.on('map:loaded', fn, { signal: scope.signal });
      };
      let paintListener = null,
        eraseListener = null;
      const mode = () =>
        ui.regionClicks.activeId === 'nations:paint'
          ? 'paint'
          : ui.regionClicks.activeId === 'nations:erase'
            ? 'erase'
            : ui.regionClicks.activeId === null
              ? 'select'
              : null;
      const setMode = (value) => {
        if (value === 'select') ui.regionClicks.clearActive();
        else {
          openNations();
          (value === 'paint' ? paintListener : eraseListener).activate();
        }
      };
      const choose = (id) => {
        activeNation = id;
        setMode('paint');
        ui.emit('nations:selection', {});
      };
      const addNationToSet = (id) => {
        const nation = model.data.items[id];
        if (!nation) return;
        if (!ui.extensions.isEnabled('metadata')) {
          ui.notify('Включите модуль «Метаданные и статистика».');
          return;
        }
        const regionIds = Object.entries(model.data.owners)
          .filter(([, owner]) => owner === id)
          .map(([regionId]) => Number(regionId));
        ui.emit('statistics:add-regions', { regionIds });
        ui.notify(
          'В набор добавлены территории нации «' + nation.name + '»: ' + regionIds.length + '.',
        );
      };
      function editNation(id = null) {
        const original = model.data.items[id];
        return ctx.window({
          id: 'nation-editor:' + (id || 'new'),
          title: original ? 'Редактор нации' : 'Новая нация',
          x: 300,
          y: 60,
          width: 285,
          height: 238,
          render(pane, scope, tab) {
            const name = document.createElement('input');
            name.value = original?.name || '';
            name.maxLength = 80;
            name.placeholder = 'Название нации';
            name.setAttribute('aria-label', 'Название нации');
            const color = document.createElement('input');
            color.type = 'color';
            color.value = original?.color || '#75937d';
            color.setAttribute('aria-label', 'Цвет нации');
            pane.append(field('Название', name), field('Цвет', color));
            const actions = el('div', 'form-actions');
            actions.append(
              button(
                'Сохранить',
                protect(() => {
                  activeNation = model.setNation({
                    id: id || undefined,
                    name: name.value,
                    color: color.value,
                  });
                  setMode('paint');
                  tab.close();
                }),
                { className: 'accent' },
              ),
            );
            if (id) {
              let armed = false;
              const remove = button('Удалить', () => {
                if (!armed) {
                  armed = true;
                  remove.textContent = 'Удалить и освободить земли?';
                  return;
                }
                model.removeNation(id);
                tab.close();
              });
              actions.append(remove);
            }
            pane.append(actions);
            name.focus();
          },
        });
      }
      function openNationInfo(id = activeNation) {
        const initial = model.data.items[id];
        if (!initial) return;
        return ctx.window({
          id: 'nation-info:' + id,
          windowId: 'information',
          title: initial.name,
          x: 295,
          y: 30,
          width: 315,
          height: 365,
          render(pane, scope, tab) {
            let candidate = '';
            const draw = () => {
              const nation = model.data.items[id];
              if (!nation) {
                tab.close();
                return;
              }
              const enemies = model.enemies(id),
                enemySet = new Set(enemies.map((n) => n.id));
              tab.setTitle(nation.name);
              const header = el('div', 'nation-info-header'),
                swatch = el('span', 'nation-swatch');
              swatch.style.background = validColor(nation.color) ? nation.color : '#888888';
              header.append(swatch, el('strong', 'nation-info-name', nation.name));
              pane.replaceChildren(header);
              const count = Object.values(model.data.owners).filter((owner) => owner === id).length;
              pane.append(
                createDataRow('Провинций', String(count)),
                createDataRow('Противников', String(enemies.length)),
              );
              const status = el(
                'div',
                'nation-diplomacy-status' + (enemies.length ? ' at-war' : ''),
                enemies.length ? 'В состоянии войны' : 'Мир',
              );
              pane.append(
                status,
                button('Редактировать нацию', () => editNation(id), { className: 'small wide' }),
              );
              pane.append(
                button(
                  'Статистика территорий',
                  () => {
                    if (!ui.extensions.isEnabled('metadata')) {
                      ui.notify('Включите модуль «Метаданные и статистика».');
                      return;
                    }
                    ui.emit('statistics:open', {
                      regionIds: Object.entries(model.data.owners)
                        .filter(([, owner]) => owner === id)
                        .map(([regionId]) => Number(regionId)),
                      title: nation.name,
                    });
                  },
                  { className: 'small wide' },
                ),
              );
              pane.append(
                button('Добавить территории в набор', () => addNationToSet(id), {
                  className: 'small wide',
                }),
              );
              pane.append(el('div', 'section-line', 'ПРОТИВНИКИ'));
              for (const enemy of enemies) {
                const row = el('div', 'nation-enemy-row'),
                  name = button(enemy.name, () => openNationInfo(enemy.id), {
                    className: 'nation-enemy-name',
                    title: 'Информация о нации ' + enemy.name,
                  });
                name.replaceChildren(createDataRow(enemy.name, ''));
                const peace = button(
                  'Мир',
                  protect(() => model.setWar(id, enemy.id, false)),
                  { className: 'small', title: 'Заключить мир с нацией ' + enemy.name },
                );
                peace.setAttribute('aria-label', 'Заключить мир с нацией ' + enemy.name);
                row.append(name, peace);
                pane.append(row);
              }
              if (!enemies.length) pane.append(el('p', 'muted small', 'Противников нет.'));
              const available = Object.values(model.data.items).filter(
                (n) => n.id !== id && !enemySet.has(n.id),
              );
              if (available.length) {
                const select = document.createElement('select');
                select.setAttribute('aria-label', 'Новый противник');
                select.append(new Option('Выберите нацию', ''));
                for (const other of available) select.append(new Option(other.name, other.id));
                if (!available.some((n) => n.id === candidate)) candidate = '';
                select.value = candidate;
                const declare = button(
                  'Объявить войну',
                  protect(() => {
                    const enemyId = select.value;
                    candidate = '';
                    model.setWar(id, enemyId, true);
                  }),
                  { className: 'danger wide' },
                );
                declare.disabled = !select.value;
                select.onchange = () => {
                  candidate = select.value;
                  declare.disabled = !candidate;
                };
                pane.append(field('Добавить', select), declare);
              } else
                pane.append(
                  el(
                    'p',
                    'muted small',
                    Object.keys(model.data.items).length > 1
                      ? 'Все остальные нации уже в списке противников.'
                      : 'Других наций пока нет.',
                  ),
                );
              pane.append(
                el(
                  'p',
                  'muted small',
                  'Война взаимна. Общая граница с противником выделена красным.',
                ),
              );
            };
            onState(draw, scope);
            draw();
          },
        });
      }
      function openNations() {
        return ctx.window({
          id: 'list',
          title: 'Нации',
          x: 14,
          y: 18,
          width: 260,
          height: 355,
          render(pane, scope, tab) {
            const paint = tab.onRegionClick(
              protect((event) => model.assign([event.id], activeNation)),
              {
                id: 'nations:paint',
                mode: 'active',
                label: 'Кисть нации',
                enabled: () => !!model.data.items[activeNation],
              },
            );
            const erase = tab.onRegionClick(
              protect((event) => model.assign([event.id], null)),
              { id: 'nations:erase', mode: 'active', label: 'Ластик нации' },
            );
            paintListener = paint;
            eraseListener = erase;
            scope.defer(() => {
              if (paintListener === paint) paintListener = null;
              if (eraseListener === erase) eraseListener = null;
            });
            const draw = () => {
              if (!model.data.items[activeNation])
                activeNation = Object.keys(model.data.items)[0] || null;
              pane.replaceChildren();
              const tools = el('div', 'tool-row');
              for (const [key, label] of [
                ['paint', 'Кисть'],
                ['select', 'Просмотр'],
                ['erase', 'Ластик'],
              ]) {
                const tool = button(label, () => setMode(key), {
                  className: mode() === key ? 'active' : '',
                });
                tool.disabled = key === 'paint' && !activeNation;
                tool.setAttribute('aria-pressed', String(mode() === key));
                tools.append(tool);
              }
              pane.append(tools);
              const counts = {};
              for (const id of Object.values(model.data.owners)) counts[id] = (counts[id] || 0) + 1;
              for (const nation of Object.values(model.data.items)) {
                const row = el(
                    'div',
                    'nation-row' + (activeNation === nation.id ? ' selected' : ''),
                  ),
                  chooseButton = button(
                    '',
                    () => {
                      choose(nation.id);
                      draw();
                    },
                    { className: 'nation-select', title: String(nation.name) },
                  );
                const swatch = el('span', 'nation-swatch');
                swatch.style.background = validColor(nation.color) ? nation.color : '#888888';
                chooseButton.append(
                  swatch,
                  createDataRow(String(nation.name), String(counts[nation.id] || 0)),
                );
                const info = button('ⓘ', () => openNationInfo(nation.id), {
                  title: 'Информация о нации ' + nation.name,
                  className: 'icon-button',
                });
                info.setAttribute('aria-label', 'Информация о нации ' + nation.name);
                const add = button('⊞', () => addNationToSet(nation.id), {
                  title: 'Добавить территории нации ' + nation.name + ' в набор',
                  className: 'icon-button',
                });
                add.setAttribute(
                  'aria-label',
                  'Добавить территории нации ' + nation.name + ' в набор',
                );
                row.append(
                  chooseButton,
                  add,
                  info,
                  button('✎', () => editNation(nation.id), {
                    title: 'Редактировать ' + nation.name,
                    className: 'icon-button',
                  }),
                );
                pane.append(row);
              }
              pane.append(button('+ Нация', () => editNation(), { className: 'wide' }));
            };
            onState(draw, scope);
            ui.regionClicks.on('change', draw, { signal: scope.signal });
            ui.on('nations:selection', draw, { signal: scope.signal });
            draw();
          },
        });
      }
      function openInspector() {
        return ctx.window({
          id: 'inspector',
          title: 'Провинция',
          x: 14,
          y: 387,
          width: 260,
          height: 260,
          render(pane, scope, tab) {
            const draw = () => {
              const region = state.regionIndex.get(selected);
              pane.replaceChildren();
              if (!region) {
                pane.append(
                  el(
                    'p',
                    'muted',
                    'Нажмите на провинцию на карте. Правый клик открывает её контекстное меню.',
                  ),
                );
                return;
              }
              pane.append(el('div', 'inspector-id', 'ПРОВИНЦИЯ #' + selected));
              const name = document.createElement('input');
              name.value = model.data.names[selected] || '';
              name.placeholder = 'Без названия';
              name.setAttribute('aria-label', 'Название провинции');
              name.onchange = protect(() => model.setProvince(selected, { name: name.value }));
              const owner = document.createElement('select');
              owner.setAttribute('aria-label', 'Владелец провинции');
              owner.append(new Option('Свободная территория', ''));
              for (const nation of Object.values(model.data.items))
                owner.append(new Option(String(nation.name), nation.id));
              owner.value = model.data.owners[selected] || '';
              owner.onchange = protect(() => model.assign([selected], owner.value || null));
              pane.append(field('Название', name), field('Владелец', owner));
              if (owner.value)
                pane.append(
                  button('Информация о нации', () => openNationInfo(owner.value), {
                    className: 'wide small',
                  }),
                );
              pane.append(
                el(
                  'p',
                  'muted mono small',
                  region.area.toLocaleString('ru-RU') +
                    ' px · X ' +
                    region.anchor[0] +
                    ' Y ' +
                    region.anchor[1],
                ),
              );
            };
            const update = (e) => {
              selected = e.id;
              draw();
            };
            tab.onRegionClick(update);
            ui.input.on(
              'selection:change',
              (e) => {
                if (!e.fromClick) update(e);
              },
              { signal: scope.signal },
            );
            onState(draw, scope);
            draw();
          },
        });
      }
      ctx.on('selection:change', (event) => {
        selected = event.id;
      });
      ctx.windowMenu({ id: 'list', label: 'Нации', handler: openNations });
      ctx.windowMenu({
        id: 'info',
        label: 'Информация о выбранной нации',
        enabled: () => !!model.data.items[activeNation],
        handler: () => openNationInfo(),
      });
      ctx.windowMenu({ id: 'inspector', label: 'Свойства провинции', handler: openInspector });
      ctx.menu(ui.mainMenu, {
        id: 'open',
        path: ['Мир', 'Нации'],
        label: 'Список наций',
        handler: openNations,
      });
      ctx.menu(ui.mainMenu, {
        id: 'new-nation',
        path: ['Мир', 'Нации'],
        label: 'Создать нацию',
        handler: () => editNation(),
      });
      ctx.menu(ui.mainMenu, {
        id: 'nation-info',
        path: ['Мир', 'Нации'],
        label: 'Информация о выбранной нации',
        enabled: () => !!model.data.items[activeNation],
        handler: () => openNationInfo(),
      });
      ctx.menu(ui.mainMenu, {
        id: 'nation-edit',
        path: ['Мир', 'Нации'],
        label: 'Редактировать выбранную нацию',
        enabled: () => !!model.data.items[activeNation],
        handler: () => editNation(activeNation),
      });
      ctx.menu(ui.mainMenu, {
        id: 'assign-selection',
        path: ['Мир', 'Нации'],
        label: 'Назначить выделение выбранной нации',
        enabled: () => !!model.data.items[activeNation] && ui.regionSelection.size > 0,
        handler: () => model.assign(ui.regionSelection.ids, activeNation),
      });
      ctx.menu(ui.mainMenu, {
        id: 'release-selection',
        path: ['Мир', 'Нации'],
        label: 'Освободить выделенные провинции',
        enabled: () => ui.regionSelection.size > 0,
        handler: () => model.assign(ui.regionSelection.ids, null),
      });
      ctx.menu(ui.mainMenu, {
        id: 'nation-set',
        path: ['Мир', 'Нации'],
        label: 'Добавить территории выбранной нации в набор',
        enabled: () => !!model.data.items[activeNation],
        handler: () => addNationToSet(activeNation),
      });
      ctx.menu(ui.mainMenu, {
        id: 'select-nation',
        path: ['Инструменты', 'Выделение'],
        label: 'Выделить территории выбранной нации',
        enabled: () => !!model.data.items[activeNation],
        handler: () => ui.regionSelection.replace(model.members(activeNation)),
      });
      ctx.menu(ui.tileMenu, {
        id: 'assign',
        path: ['Мир', 'Владения'],
        label: 'Назначить выбранной нации',
        batch: true,
        order: 0,
        enabled: () => !!model.data.items[activeNation],
        handler: (ids) => model.assign(ids, activeNation),
      });
      ctx.menu(ui.tileMenu, {
        id: 'release',
        path: ['Мир', 'Владения'],
        label: 'Освободить',
        batch: true,
        order: 1,
        handler: (ids) => model.assign(ids, null),
      });
      ctx.menu(ui.tileMenu, {
        id: 'goto',
        path: ['Мир', 'Владения'],
        label: 'К нации',
        order: 2,
        enabled: (e) => model.nationsFor([e.id]).length > 0,
        handler: (id) => {
          activeNation = model.data.owners[id];
          openNations();
          ui.emit('nations:selection', {});
        },
      });
      ctx.menu(ui.tileMenu, {
        id: 'select',
        path: ['Мир', 'Владения'],
        label: 'Выделить нацию',
        order: 3,
        enabled: (e) => model.nationsFor([e.id]).length > 0,
        handler: (id) => ui.regionSelection.replace(model.members(model.data.owners[id])),
      });
      ctx.menu(ui.tileMenu, {
        id: 'nation-info',
        path: ['Мир', 'Владения'],
        label: 'Информация',
        batch: true,
        order: 4,
        enabled: (e) => model.nationsFor(e.regionIds).length > 0,
        handler: (ids) => {
          let windowId = null;
          for (const id of model.nationsFor(ids)) {
            const tab = openNationInfo(id);
            if (windowId) ui.windows.moveTab(tab.id, windowId);
            else windowId = tab.windowId;
          }
        },
      });
      ctx.menu(ui.tileMenu, {
        id: 'inspect',
        path: ['Провинция'],
        label: 'Свойства',
        order: 100,
        handler: (id) => {
          ui.viewport.select(id);
          openInspector();
        },
      });
      ui.registerTooltip(
        'nations',
        (e) => {
          const d = model.data,
            owner = d.items[d.owners[e.id]];
          return (
            (d.names[e.id] ? d.names[e.id] + ' · ' : '') + (owner?.name || 'Свободная территория')
          );
        },
        { signal },
      );
      ui.registerStatus(
        'nations',
        () =>
          Object.keys(model.data.owners).length +
          ' назначено' +
          (mode() === 'paint'
            ? ' · ' + (model.data.items[activeNation]?.name || 'выберите нацию')
            : ''),
        { signal },
      );
      openNations();
      openInspector();
    },
  };
  Object.assign((root.AtlasExtensions ||= {}), {
    NationsModel,
    NationPainter,
    nations: definition,
  });
})(globalThis);
