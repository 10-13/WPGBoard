/* Blueprint editors and dependency trees use the shared data-view primitives. */
(function (root) {
  'use strict';
  const { el, button, field } = root.AtlasUI.dom,
    { createDataRow, createDataGroup } = root.AtlasUI.dataView;
  const format = (n) => n.toLocaleString('ru-RU', { maximumSignificantDigits: 8 });
  class ResourceCatalogUI {
    constructor(ctx, catalog) {
      this.ctx = ctx;
      this.catalog = catalog;
      this.target = 'steel';
      this.amount = 1;
      this.choices = {};
      this.protect =
        (fn) =>
        (...args) => {
          try {
            return fn(...args);
          } catch (e) {
            ctx.ui.notify(e.message);
          }
        };
      ctx.windowMenu({ id: 'blueprints', label: 'Чертежи', handler: () => this.openRecipes() });
      ctx.windowMenu({
        id: 'goods',
        label: 'Каталог ресурсов',
        handler: () => this.openResources(),
      });
      ctx.windowMenu({
        id: 'resource-tree',
        label: 'Дерево ресурсов',
        handler: () => this.openTree(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'blueprints',
        path: ['Мир', 'Ресурсы'],
        label: 'Чертежи',
        handler: () => this.openRecipes(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'goods',
        path: ['Мир', 'Ресурсы'],
        label: 'Каталог ресурсов',
        handler: () => this.openResources(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'resource-tree',
        path: ['Мир', 'Ресурсы'],
        label: 'Дерево ресурсов',
        handler: () => this.openTree(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'new-blueprint',
        path: ['Мир', 'Ресурсы'],
        label: 'Создать чертёж',
        handler: () => this.editRecipe(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'new-good',
        path: ['Мир', 'Ресурсы'],
        label: 'Создать ресурс',
        handler: () => this.editResource(),
      });
      ctx.state.on(
        'map:loaded',
        () => {
          this.choices = {};
        },
        { signal: ctx.signal },
      );
    }
    watch(scope, draw) {
      this.ctx.state.on('change', draw, { signal: scope.signal });
      this.ctx.state.on('map:loaded', draw, { signal: scope.signal });
    }
    group(label, key, expanded, open = true) {
      return createDataGroup(label, {
        id: key,
        open: expanded.has(key) ? expanded.get(key) : open,
        onToggle: (value) => expanded.set(key, value),
      });
    }
    quantity(row) {
      const r = this.catalog.data.resources[row.resourceId];
      return format(row.amount) + ' ' + r.unit;
    }
    summary(rows) {
      return (
        rows
          .map(
            (row) => this.catalog.data.resources[row.resourceId].name + ' × ' + this.quantity(row),
          )
          .join(' + ') || 'Нет'
      );
    }
    navigation(pane) {
      const row = el('div', 'tool-row');
      row.append(
        button('Чертежи', () => this.openRecipes()),
        button('Ресурсы', () => this.openResources()),
        button('Дерево', () => this.openTree()),
      );
      pane.append(row);
    }
    removeButton(label, action) {
      let armed = false;
      const remove = button(
        label,
        this.protect(() => {
          if (!armed) {
            armed = true;
            remove.textContent = 'Подтвердить удаление';
          } else action();
        }),
      );
      return remove;
    }
    openRecipes() {
      return this.ctx.window({
        id: 'blueprints',
        windowId: 'catalog',
        title: 'Чертежи',
        x: 290,
        y: 30,
        width: 420,
        height: 570,
        render: (pane, scope) => {
          const expanded = new Map();
          this.navigation(pane);
          pane.append(
            el(
              'p',
              'muted',
              'Чертёж задаёт только объёмы входа и выхода. Мощность задаётся у производства. Пропорции базового набора — игровые.',
            ),
          );
          pane.append(button('+ Чертёж', () => this.editRecipe(), { className: 'wide' }));
          const search = document.createElement('input');
          search.type = 'search';
          search.placeholder = 'Поиск по названию или ресурсу';
          search.setAttribute('aria-label', 'Поиск чертежей');
          const body = el('div', 'atlas-data-scope');
          pane.append(search, body);
          const draw = () => {
            body.replaceChildren();
            const categories = new Map(),
              query = search.value.trim().toLowerCase();
            for (const recipe of Object.values(this.catalog.data.recipes)) {
              if (
                query &&
                !(
                  recipe.name +
                  ' ' +
                  this.summary(recipe.inputs) +
                  ' ' +
                  this.summary(recipe.outputs)
                )
                  .toLowerCase()
                  .includes(query)
              )
                continue;
              const category = this.catalog.data.resources[recipe.outputs[0].resourceId].category;
              if (!categories.has(category)) categories.set(category, []);
              categories.get(category).push(recipe);
            }
            for (const [category, recipes] of categories) {
              const group = this.group(category, 'recipes:' + category, expanded);
              for (const recipe of recipes) {
                const item = this.group(recipe.name, 'recipe:' + recipe.id, expanded, false);
                item.body.append(
                  createDataRow('Вход', this.summary(recipe.inputs)),
                  createDataRow('Выход', this.summary(recipe.outputs)),
                );
                if (recipe.description)
                  item.body.append(el('p', 'metadata-description', recipe.description));
                const actions = el('div', 'tool-row');
                actions.append(
                  button('Стоимость', () => this.openTree(recipe.outputs[0].resourceId, recipe.id)),
                  button('Изменить', () => this.editRecipe(recipe.id)),
                  this.removeButton('Удалить', () => this.catalog.removeRecipe(recipe.id)),
                );
                item.body.append(actions);
                group.body.append(item.element);
              }
              body.append(group.element);
            }
            if (!categories.size) body.append(el('p', 'muted', 'Чертежи не найдены.'));
          };
          search.oninput = draw;
          this.watch(scope, draw);
          draw();
        },
      });
    }
    openResources() {
      return this.ctx.window({
        id: 'goods',
        windowId: 'catalog',
        title: 'Ресурсы',
        x: 290,
        y: 30,
        width: 420,
        height: 570,
        render: (pane, scope) => {
          const expanded = new Map();
          this.navigation(pane);
          pane.append(button('+ Ресурс', () => this.editResource(), { className: 'wide' }));
          const search = document.createElement('input');
          search.type = 'search';
          search.placeholder = 'Название ресурса';
          search.setAttribute('aria-label', 'Поиск ресурсов');
          const body = el('div', 'atlas-data-scope');
          pane.append(search, body);
          const draw = () => {
            body.replaceChildren();
            const categories = new Map(),
              query = search.value.trim().toLowerCase();
            for (const resource of Object.values(this.catalog.data.resources)) {
              if (query && !resource.name.toLowerCase().includes(query)) continue;
              if (!categories.has(resource.category)) categories.set(resource.category, []);
              categories.get(resource.category).push(resource);
            }
            for (const [category, resources] of categories) {
              const group = this.group(category, 'goods:' + category, expanded);
              for (const resource of resources) {
                const item = this.group(resource.name, 'good:' + resource.id, expanded, false);
                const swatch = el('span', 'resource-legend-swatch');
                swatch.style.backgroundColor = this.catalog.color(resource.id);
                swatch.setAttribute('aria-hidden', 'true');
                item.element.querySelector('.data-group-name').prepend(swatch);
                item.body.append(
                  createDataRow(
                    'Тип',
                    resource.kind === 'raw' ? 'Природный ресурс' : 'Продукт переработки',
                  ),
                  createDataRow('Единица', resource.unit),
                  createDataRow('Чертежей', String(this.catalog.recipesFor(resource.id).length)),
                );
                item.body.append(createDataRow('Цвет', this.catalog.color(resource.id)));
                if (resource.description)
                  item.body.append(el('p', 'metadata-description', resource.description));
                const actions = el('div', 'tool-row');
                actions.append(
                  button('Дерево', () => this.openTree(resource.id)),
                  button('Изменить', () => this.editResource(resource.id)),
                  this.removeButton('Удалить', () => this.catalog.removeResource(resource.id)),
                );
                item.body.append(actions);
                group.body.append(item.element);
              }
              body.append(group.element);
            }
            if (!categories.size) body.append(el('p', 'muted', 'Ресурсы не найдены.'));
          };
          search.oninput = draw;
          this.watch(scope, draw);
          draw();
        },
      });
    }
    editResource(id = null) {
      const original = this.catalog.data.resources[id];
      return this.ctx.window({
        id: 'good-edit:' + (id || 'new'),
        title: original ? 'Изменить ресурс' : 'Новый ресурс',
        x: 330,
        y: 70,
        width: 350,
        height: 350,
        render: (pane, scope, tab) => {
          const form = el('form'),
            name = document.createElement('input'),
            category = document.createElement('input'),
            unit = document.createElement('input'),
            kind = document.createElement('select'),
            description = document.createElement('textarea');
          const color = document.createElement('input'),
            colorHex = document.createElement('input'),
            colorControls = el('div', 'resource-color-controls');
          for (const [node, label, value, limit] of [
            [name, 'Название ресурса', original?.name || '', 80],
            [category, 'Категория ресурса', original?.category || 'Прочее', 80],
            [unit, 'Единица ресурса', original?.unit || 'ед.', 40],
          ]) {
            node.value = value;
            node.required = true;
            node.maxLength = limit;
            node.setAttribute('aria-label', label);
          }
          kind.append(
            new Option('Природный ресурс', 'raw'),
            new Option('Продукт переработки', 'product'),
          );
          kind.value = original?.kind || 'product';
          kind.setAttribute('aria-label', 'Тип ресурса');
          description.value = original?.description || '';
          description.maxLength = 4000;
          description.rows = 4;
          description.setAttribute('aria-label', 'Описание ресурса');
          color.type = 'color';
          color.value = this.catalog.color(original?.id || 'Новый ресурс');
          color.setAttribute('aria-label', 'Цвет ресурса');
          colorHex.value = color.value;
          colorHex.required = true;
          colorHex.maxLength = 7;
          colorHex.pattern = '#[0-9a-fA-F]{6}';
          colorHex.setAttribute('aria-label', 'Цвет ресурса HEX');
          colorHex.title = 'Цвет в формате #RRGGBB';
          color.oninput = () => {
            colorHex.value = color.value;
          };
          colorHex.oninput = () => {
            if (root.AtlasExtensions.isResourceColor(colorHex.value)) color.value = colorHex.value;
          };
          colorControls.append(color, colorHex);
          form.append(
            field('Название', name),
            field('Категория', category),
            field('Единица', unit),
            field('Тип', kind),
            field('Цвет', colorControls),
            field('Описание', description),
          );
          form.append(
            el(
              'p',
              'muted',
              'Цвет — часть ресурса: сохраняется в игре и передаётся с JSON и HTML.',
            ),
          );
          const save = button('Сохранить ресурс', () => {}, { className: 'accent wide' });
          save.type = 'submit';
          form.append(save);
          form.onsubmit = this.protect((e) => {
            e.preventDefault();
            this.catalog.saveResource({
              ...(id ? { id } : {}),
              name: name.value,
              category: category.value,
              unit: unit.value,
              kind: kind.value,
              description: description.value,
              color: colorHex.value,
            });
            tab.close();
          });
          this.ctx.state.on('map:loaded', () => tab.close(), { signal: scope.signal });
          pane.append(form);
          name.focus();
        },
      });
    }
    editRecipe(id = null) {
      const original = this.catalog.data.recipes[id];
      return this.ctx.window({
        id: 'blueprint-edit:' + (id || 'new'),
        title: original ? 'Изменить чертёж' : 'Новый чертёж',
        x: 330,
        y: 40,
        width: 390,
        height: 550,
        render: (pane, scope, tab) => {
          const form = el('form'),
            name = document.createElement('input'),
            description = document.createElement('textarea');
          name.value = original?.name || '';
          name.required = true;
          name.maxLength = 100;
          name.setAttribute('aria-label', 'Название чертежа');
          description.value = original?.description || '';
          description.rows = 2;
          description.maxLength = 4000;
          description.setAttribute('aria-label', 'Описание чертежа');
          form.append(field('Название', name), field('Описание', description));
          const sides = {};
          for (const [side, label] of [
            ['inputs', 'Вход'],
            ['outputs', 'Выход'],
          ]) {
            const records = [],
              rows = el('div');
            let sequence = 0;
            sides[side] = records;
            const add = (initial = {}) => {
              const n = ++sequence,
                row = el('div', 'resource-input-row'),
                resource = document.createElement('select'),
                amount = document.createElement('input'),
                controls = el('div', 'resource-input-controls'),
                unit = el('span', 'muted');
              resource.append(new Option('Выберите ресурс', ''));
              for (const good of Object.values(this.catalog.data.resources))
                resource.append(new Option(good.name, good.id));
              resource.value = initial.resourceId || '';
              resource.required = true;
              resource.setAttribute('aria-label', label + ': ресурс ' + n);
              const showUnit = () => {
                unit.textContent = this.catalog.data.resources[resource.value]?.unit || '';
              };
              resource.onchange = showUnit;
              showUnit();
              amount.type = 'number';
              amount.min = '0';
              amount.step = 'any';
              amount.required = true;
              amount.value = initial.amount ?? 1;
              amount.setAttribute('aria-label', label + ': объём ' + n);
              const record = { resource, amount };
              controls.append(
                amount,
                unit,
                button(
                  '×',
                  () => {
                    records.splice(records.indexOf(record), 1);
                    row.remove();
                  },
                  { title: 'Удалить: ' + label + ' ' + n, className: 'icon-button' },
                ),
              );
              row.append(resource, controls);
              rows.append(row);
              records.push(record);
            };
            for (const row of original?.[side] || (side === 'outputs' ? [{}] : [])) add(row);
            form.append(
              el('div', 'section-line', label),
              rows,
              button('+ ' + label, () => add()),
            );
          }
          form.append(
            el(
              'p',
              'muted',
              'Любые положительные объёмы. Для природной добычи вход может быть пустым. Производительность предприятия в чертёж не входит.',
            ),
          );
          const save = button('Сохранить чертёж', () => {}, { className: 'accent wide' });
          save.type = 'submit';
          form.append(save);
          form.onsubmit = this.protect((e) => {
            e.preventDefault();
            const rows = (side) =>
              sides[side].map((r) => ({
                resourceId: r.resource.value,
                amount: Number(r.amount.value),
              }));
            this.catalog.saveRecipe({
              ...(id ? { id } : {}),
              name: name.value,
              description: description.value,
              inputs: rows('inputs'),
              outputs: rows('outputs'),
            });
            tab.close();
          });
          this.ctx.state.on('map:loaded', () => tab.close(), { signal: scope.signal });
          pane.append(form);
          name.focus();
        },
      });
    }
    openTree(resourceId, recipeId) {
      if (resourceId) this.target = resourceId;
      if (recipeId) this.choices[this.target] = recipeId;
      this.ctx.ui.emit('resources:catalog-tree', {});
      return this.ctx.window({
        id: 'resource-tree',
        windowId: 'catalog',
        title: 'Дерево ресурсов',
        x: 290,
        y: 30,
        width: 440,
        height: 610,
        render: (pane, scope) => {
          const expanded = new Map();
          this.navigation(pane);
          const resource = document.createElement('select'),
            amount = document.createElement('input'),
            body = el('div', 'atlas-data-scope');
          resource.setAttribute('aria-label', 'Ресурс дерева');
          amount.type = 'number';
          amount.min = '0';
          amount.step = 'any';
          amount.value = this.amount;
          amount.required = true;
          amount.setAttribute('aria-label', 'Объём для расчёта');
          pane.append(
            field('Ресурс', resource),
            field('Объём выхода', amount),
            el('p', 'muted', 'Исходное сырьё на выбранный объём. В узлах можно менять чертёж.'),
            body,
          );
          const draw = () => {
            const data = this.catalog.data;
            resource.replaceChildren();
            for (const good of Object.values(data.resources))
              resource.append(new Option(good.name, good.id));
            if (!data.resources[this.target]) this.target = Object.keys(data.resources)[0];
            resource.value = this.target || '';
            body.replaceChildren();
            let plan;
            try {
              plan = this.catalog.cost(this.target, Number(amount.value), {
                recipes: this.choices,
              });
            } catch (e) {
              body.append(el('p', 'form-error', e.message));
              return;
            }
            const costs = (node, container, key, open) => {
              const cost = this.group('Стоимость в исходном сырье', key, expanded, open);
              for (const row of node.raw)
                cost.body.append(
                  createDataRow(data.resources[row.resourceId].name, this.quantity(row)),
                );
              if (!node.raw.length && node.complete) cost.body.append(createDataRow('Вход', 'Нет'));
              for (const row of node.unresolved)
                cost.body.append(
                  createDataRow(
                    'Не раскрыто: ' + data.resources[row.resourceId].name,
                    this.quantity(row),
                  ),
                );
              container.append(cost.element);
            };
            costs(plan, body, 'total', true);
            if (!plan.complete)
              body.append(
                el(
                  'p',
                  'form-error',
                  'Цепочка раскрыта не полностью. Не раскрытые ресурсы не считаются природным сырьём.',
                ),
              );
            const render = (node, parent, path) => {
              const good = data.resources[node.resourceId],
                key = path + '/' + good.id;
              const variants = this.catalog.recipesFor(good.id);
              if (node.status === 'raw' && !variants.length) {
                parent.append(createDataRow(good.name, this.quantity(node)));
                return;
              }
              const group = this.group(
                good.name + ' · ' + this.quantity(node),
                key,
                expanded,
                path.split('/').length < 3,
              );
              parent.append(group.element);
              if (
                good.kind === 'raw' ||
                variants.length > 1 ||
                (!node.recipeId && variants.length)
              ) {
                const choice = document.createElement('select');
                choice.setAttribute('aria-label', 'Чертёж для ' + good.name);
                if (good.kind === 'raw') choice.append(new Option('Природный ресурс', ''));
                else if (!node.recipeId) choice.append(new Option('Выберите чертёж', ''));
                for (const recipe of variants) choice.append(new Option(recipe.name, recipe.id));
                choice.value = node.recipeId || '';
                choice.onchange = () => {
                  this.choices[good.id] = choice.value || null;
                  draw();
                };
                group.body.append(field('Источник', choice));
              }
              if (node.status !== 'recipe') {
                const status = {
                  raw: 'Природный ресурс',
                  missing: 'Нет подходящего чертежа',
                  cycle: 'Цикл в цепочке рецептов',
                  limit: 'Достигнут предел размера дерева',
                };
                group.body.append(createDataRow('Источник', status[node.status]));
                return;
              }
              const recipe = data.recipes[node.recipeId];
              if (variants.length === 1 && good.kind !== 'raw')
                group.body.append(createDataRow('Чертёж', recipe.name));
              group.body.append(
                createDataRow('Вход чертежа', this.summary(recipe.inputs)),
                createDataRow('Выход чертежа', this.summary(recipe.outputs)),
                createDataRow('Масштаб', format(node.batches)),
              );
              if (recipe.description)
                group.body.append(el('p', 'metadata-description', recipe.description));
              for (const row of node.outputs.filter((row) => row.resourceId !== good.id))
                group.body.append(
                  createDataRow(
                    'Сопутствующий выход: ' + data.resources[row.resourceId].name,
                    this.quantity(row),
                  ),
                );
              if (node.outputs.length > 1)
                group.body.append(
                  el(
                    'p',
                    'muted',
                    'Полный вход отнесён на выбранный выход. Сопутствующие продукты не вычитаются из стоимости других ветвей.',
                  ),
                );
              if (node.inputs.length) {
                const input = this.group('Вход на выбранный объём', key + ':inputs', expanded);
                for (const child of node.inputs) render(child, input.body, key);
                group.body.append(input.element);
              } else group.body.append(createDataRow('Вход', 'Нет'));
              if (path !== 'chain') costs(node, group.body, key + ':cost', false);
            };
            render(plan, body, 'chain');
          };
          resource.onchange = () => {
            this.target = resource.value;
            draw();
          };
          amount.oninput = () => {
            this.amount = Number(amount.value);
            draw();
          };
          this.watch(scope, draw);
          this.ctx.ui.on('resources:catalog-tree', draw, { signal: scope.signal });
          draw();
        },
      });
    }
  }
  Object.assign((root.AtlasExtensions ||= {}), { ResourceCatalogUI });
})(globalThis);
