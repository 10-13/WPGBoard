(function (root) {
  'use strict';
  const { el, button, field } = root.AtlasUI.dom,
    { createDataRow } = root.AtlasUI.dataView;
  const { createTextInput } = root.AtlasUI.components;
  const definition = {
    id: 'regions',
    name: 'Регионы',
    description: 'Именованные регионы, состав провинций, границы и подписи на карте.',
    start(ctx) {
      const { state, ui, signal } = ctx,
        model = new root.AtlasExtensions.RegionsModel(state);
      model.registerActions(signal);
      ui.overlayAreas.register(
        'regions',
        {
          getAreas() {
            const members = new Map();
            for (const [province, region] of Object.entries(model.data.assignments)) {
              const id = Number(province);
              if (!state.regions.has(id)) continue;
              if (!members.has(region)) members.set(region, []);
              members.get(region).push(id);
            }
            return Object.values(model.data.items).map((region) => ({
              id: region.id,
              title: region.name,
              provinceIds: members.get(region.id) || [],
            }));
          },
        },
        { signal },
      );
      new root.AtlasExtensions.RegionOverlay(ctx, model);
      let activeRegion = Object.keys(model.data.items)[0] || null;
      const protect =
        (fn) =>
        (...args) => {
          try {
            return fn(...args);
          } catch (error) {
            ui.notify(error.message);
          }
        };
      const select = (id) => {
        activeRegion = id;
        ui.emit('regions:active', { id });
      };
      const selectOnMap = (id) => ui.regionSelection.replace(model.members(id));
      function edit(id = null) {
        const original = model.data.items[id],
          provinceIds = id ? null : ui.regionSelection.ids,
          mapId = state.map.id;
        return ctx.window({
          id: 'edit:' + (id || 'new'),
          title: original ? 'Название региона' : 'Новый регион',
          x: 310,
          y: 85,
          width: 300,
          height: 180,
          render(pane, scope, tab) {
            const form = el('form'),
              name = createTextInput({
                value: original?.name || '',
                required: true,
                maxLength: 80,
                label: 'Название региона',
              });
            form.append(field('Название', name));
            if (!id)
              form.append(
                el(
                  'p',
                  'muted',
                  'Провинций в новом регионе: ' +
                    provinceIds.length +
                    '. Используется выделение на момент открытия формы.',
                ),
              );
            const save = button('Сохранить регион', () => {}, { className: 'accent wide' });
            save.type = 'submit';
            form.append(save);
            form.onsubmit = protect((event) => {
              event.preventDefault();
              const savedId = model.save({
                id: id || undefined,
                name: name.value,
                ...(provinceIds ? { provinceIds } : {}),
              });
              select(savedId);
              open();
              tab.close();
            });
            state.on(
              'map:loaded',
              () => {
                if (state.map.id !== mapId) tab.close();
              },
              { signal: scope.signal },
            );
            pane.append(form);
            name.focus();
          },
        });
      }
      function open(id = activeRegion) {
        if (model.data.items[id]) select(id);
        return ctx.window({
          id: 'list',
          title: 'Регионы',
          x: 285,
          y: 30,
          width: 300,
          height: 330,
          render(pane, scope) {
            const draw = () => {
              if (!model.data.items[activeRegion])
                activeRegion = Object.keys(model.data.items)[0] || null;
              pane.replaceChildren(
                el(
                  'p',
                  'muted',
                  'Выберите провинции кликом и Shift + кликом, затем создайте регион или добавьте их через контекстное меню.',
                ),
              );
              const tools = el('div', 'tool-row');
              tools.append(
                button('+ Регион', () => edit(), {
                  title: 'Создать регион из выделенных провинций',
                }),
              );
              pane.append(tools);
              for (const region of Object.values(model.data.items)) {
                const row = button('', () => select(region.id), {
                  className: 'region-select' + (activeRegion === region.id ? ' active' : ''),
                  title: 'Выбрать регион ' + region.name,
                });
                row.setAttribute('aria-pressed', String(activeRegion === region.id));
                row.append(createDataRow(region.name, String(model.members(region.id).length)));
                pane.append(row);
              }
              const region = model.data.items[activeRegion];
              if (region) {
                pane.append(
                  el('div', 'section-line', 'ВЫБРАННЫЙ РЕГИОН'),
                  createDataRow('Название', region.name),
                  createDataRow('Провинций', String(model.members(region.id).length)),
                );
                const actions = el('div', 'tool-row');
                actions.append(
                  button('Выделить регион', () => selectOnMap(region.id)),
                  button('Переименовать', () => edit(region.id)),
                );
                pane.append(actions);
                let armed = false;
                const remove = button(
                  'Удалить регион',
                  protect(() => {
                    if (!armed) {
                      armed = true;
                      remove.textContent = 'Подтвердить удаление региона';
                      return;
                    }
                    model.remove(region.id);
                  }),
                  { className: 'wide' },
                );
                pane.append(remove);
              } else pane.append(el('p', 'muted', 'Регионов пока нет.'));
            };
            state.on('change', draw, { signal: scope.signal });
            state.on('map:loaded', draw, { signal: scope.signal });
            ui.on('regions:active', draw, { signal: scope.signal });
            draw();
          },
        });
      }
      ctx.windowMenu({ id: 'list', label: 'Регионы', handler: () => open() });
      ctx.menu(ui.mainMenu, {
        id: 'open',
        path: ['Мир', 'Регионы'],
        label: 'Список регионов',
        handler: () => open(),
      });
      ctx.menu(ui.mainMenu, {
        id: 'new',
        path: ['Мир', 'Регионы'],
        label: 'Создать регион из выделения',
        handler: () => edit(),
      });
      ctx.menu(ui.mainMenu, {
        id: 'rename',
        path: ['Мир', 'Регионы'],
        label: 'Переименовать выбранный регион',
        enabled: () => !!model.data.items[activeRegion],
        handler: () => edit(activeRegion),
      });
      ctx.menu(ui.mainMenu, {
        id: 'assign-selection',
        path: ['Мир', 'Регионы'],
        label: 'Добавить выделение в выбранный регион',
        enabled: () => !!model.data.items[activeRegion] && ui.regionSelection.size > 0,
        handler: () => model.assign(ui.regionSelection.ids, activeRegion),
      });
      ctx.menu(ui.mainMenu, {
        id: 'clear-selection',
        path: ['Мир', 'Регионы'],
        label: 'Исключить выделение из регионов',
        enabled: () => ui.regionSelection.ids.some((id) => !!model.forProvince(id)),
        handler: () => model.assign(ui.regionSelection.ids, null),
      });
      ctx.menu(ui.mainMenu, {
        id: 'select-region',
        path: ['Инструменты', 'Выделение'],
        label: 'Выделить выбранный регион',
        enabled: () => !!model.data.items[activeRegion],
        handler: () => selectOnMap(activeRegion),
      });
      ctx.menu(ui.tileMenu, {
        id: 'assign',
        path: ['Мир', 'Регионы'],
        label: 'Добавить в выбранный регион',
        batch: true,
        order: 10,
        enabled: () => !!model.data.items[activeRegion],
        handler: (ids) => model.assign(ids, activeRegion),
      });
      ctx.menu(ui.tileMenu, {
        id: 'clear',
        path: ['Мир', 'Регионы'],
        label: 'Очистить регион',
        batch: true,
        order: 11,
        enabled: (e) => e.regionIds.some((id) => !!model.forProvince(id)),
        handler: (ids) => model.assign(ids, null),
      });
      ctx.menu(ui.tileMenu, {
        id: 'select',
        path: ['Мир', 'Регионы'],
        label: 'Выделить регион',
        order: 12,
        enabled: (e) => !!model.forProvince(e.id),
        handler: (id) => selectOnMap(model.forProvince(id).id),
      });
      ctx.menu(ui.tileMenu, {
        id: 'goto',
        path: ['Мир', 'Регионы'],
        label: 'К региону',
        order: 13,
        enabled: (e) => !!model.forProvince(e.id),
        handler: (id) => open(model.forProvince(id).id),
      });
      ui.on('regions:open', (event) => open(event.id), { signal });
      ui.registerTooltip(
        'regions',
        (e) => {
          const region = model.forProvince(e.id);
          return region ? 'Регион: ' + region.name : '';
        },
        { signal },
      );
    },
  };
  Object.assign((root.AtlasExtensions ||= {}), { regions: definition });
})(globalThis);
