/* Ordinary resource overlay and its compact legend; visibility lives in the registry. */
(function (root) {
  'use strict';
  const { equal, normalizeOverlayScope } = root.AtlasCore;
  const { resourceRichness, projectResourceRichness } = root.AtlasExtensions;
  const { SimpleOverlay, drawProvincePaints } =
    typeof module !== 'undefined' && module.exports
      ? require('../packages/ui/simple-overlay.js')
      : root.AtlasUI;
  function drawResourceRichness(context, index, data) {
    drawProvincePaints(
      context,
      index,
      new Map([...data.winners].map(([id, winner]) => [id, winner.color])),
    );
  }
  const empty = () => ({ legend: [], winners: new Map(), provinces: new Map() });
  const hiddenResources = (options) =>
    Array.isArray(options.hiddenResources)
      ? [...new Set(options.hiddenResources.filter((key) => typeof key === 'string'))].sort()
      : [];
  const format = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 4 }),
    shortFormat = (n) => n.toLocaleString('ru-RU', { maximumSignificantDigits: 3 });
  class ResourceOverlay extends SimpleOverlay {
    constructor(ctx) {
      // Display filters reproject this world cache; they never rerun the economy.
      const source = { data: null, index: null, tiles: null, catalog: null, message: '' };
      super(ctx, {
        id: 'richness',
        title: 'Богатство ресурсов',
        order: 15,
        visible: false,
        watch: (before, after) =>
          !equal(before.meta.tiles, after.meta.tiles) ||
          !equal(before.meta.resources?.catalog, after.meta.resources?.catalog),
        createState({ meta, index, options, provinceIds }) {
          if (
            source.index !== index ||
            !equal(source.tiles, meta.tiles) ||
            !equal(source.catalog, meta.resources?.catalog)
          ) {
            source.message = '';
            try {
              const report = ctx.state.statistics.calculate([...index.regions.keys()]),
                block = report.get('resources');
              if (!block)
                throw new Error(
                  report.errors.find((e) => e.id === 'resources')?.message ||
                    'Сборщик ресурсов недоступен.',
                );
              source.data = resourceRichness(block, meta.resources?.catalog);
              if (block.invalid.length)
                source.message =
                  'Пропущено некорректных ресурсных записей: ' + block.invalid.length + '.';
            } catch (error) {
              source.data = empty();
              source.message = 'Не удалось рассчитать ресурсы: ' + error.message;
            }
            source.index = index;
            source.tiles = meta.tiles;
            source.catalog = meta.resources?.catalog;
          }
          return projectResourceRichness(source.data, hiddenResources(options), provinceIds);
        },
        paint: (_, data, { provinceId }) => data.winners.get(provinceId)?.color || null,
      });
      this.sourceCache = source;
      this.offStatistics = ctx.state.statistics.on(
        'change',
        () => {
          source.index = null;
          this.invalidate();
        },
        { signal: ctx.signal },
      );
      ctx.windowMenu({
        id: 'resource-legend',
        label: 'Легенда ресурсов',
        handler: () => this.open(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'resource-legend',
        path: ['Мир', 'Ресурсы'],
        label: 'Легенда ресурсов',
        handler: () => this.open(),
      });
      ctx.ui.registerTooltip(
        'resources:richness',
        (event) => {
          const winner = this.overlay.visible ? this.data.winners.get(event.id) : null;
          return winner
            ? 'Главный ресурс: ' +
                winner.resource +
                ' · ' +
                winner.amount.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) +
                ' ' +
                winner.unit
            : '';
        },
        { signal: ctx.signal },
      );
    }
    get hiddenResources() {
      return hiddenResources(this.options);
    }
    get provinceIds() {
      try {
        return normalizeOverlayScope(this.options.provinceIds, this.ctx.state.regionIndex);
      } catch (_) {
        return null;
      }
    }
    get data() {
      return !this.disposed && this.result ? this.ensure() : empty();
    }
    get message() {
      return this.sourceCache.message;
    }
    setResourceVisible(key, visible) {
      const hidden = new Set(this.hiddenResources);
      if (visible) hidden.delete(key);
      else hidden.add(key);
      this.ctx.state.overlays.setOptions(this.overlay.id, {
        ...this.ctx.state.overlays.getOptions(this.overlay.id),
        hiddenResources: [...hidden].sort(),
      });
    }
    setAllResourcesVisible(visible) {
      const keys = this.ensure().legend.map((item) => item.key);
      this.ctx.state.overlays.setOptions(this.overlay.id, {
        ...this.ctx.state.overlays.getOptions(this.overlay.id),
        hiddenResources: visible ? [] : [...new Set([...this.hiddenResources, ...keys])].sort(),
      });
    }
    ensure() {
      return super.ensure().state;
    }
    dispose() {
      this.offStatistics?.();
      this.offStatistics = null;
      super.dispose();
      if (this.sourceCache)
        Object.assign(this.sourceCache, {
          data: null,
          index: null,
          tiles: null,
          catalog: null,
          message: '',
        });
    }

    open() {
      const { ctx } = this;
      const { el } = root.AtlasUI.dom,
        { createSwitch, button } = root.AtlasUI.controls;
      const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
      return ctx.window({
        id: 'resource-legend',
        title: 'Легенда ресурсов',
        x: 295,
        y: 35,
        width: 360,
        height: 560,
        render: (pane, scope) => {
          pane.classList.add('atlas-data-scope');
          let expanded = true;
          const areaControl = root.AtlasUI.overlayScope.createScopeControl({
            state: ctx.state,
            selection: ctx.ui.regionSelection,
            areas: ctx.ui.overlayAreas,
            readIds: () => this.provinceIds,
            onChange: (ids) => this.setProvinceIds(ids),
            signal: scope.signal,
          });
          const draw = () => {
            const data = this.ensure();
            pane.replaceChildren();
            pane.append(
              createSwitch('Оверлей ресурсов', (checked) => this.overlay.setVisible(checked), {
                checked: this.overlay.visible,
                className: 'wide',
                title: 'Включить или выключить оверлей «Богатство ресурсов»',
              }),
              areaControl,
            );
            pane.append(
              el(
                'p',
                'muted',
                'Главный из включённых ресурсов: потенциальный выпуск с бонусами, до расходов сырья. При выключении лидера выбирается следующий ресурс. Область меняет шкалу и отрисовку, сохраняя мировой расчёт бонусов.',
              ),
            );
            pane.append(
              el(
                'p',
                'muted',
                'Шкала слева направо: минимум → максимум по провинциям с выпуском в выбранной области. Цвет: на 50% темнее → на 50% светлее. Одинаковый выпуск — базовый цвет.',
              ),
            );

            pane.append(
              createDataRow('Окрашено провинций', data.winners.size.toLocaleString('ru-RU')),
              createDataRow(
                'Без окраски',
                (
                  (this.provinceIds === null
                    ? ctx.state.regions.size
                    : this.provinceIds.filter((id) => ctx.state.regions.has(id)).length) -
                  data.winners.size
                ).toLocaleString('ru-RU'),
              ),
            );
            if (this.message) pane.append(el('p', 'form-error', this.message));
            if (!data.legend.length) {
              pane.append(
                el(
                  'p',
                  'muted',
                  'В выбранной области нет производств с положительным выпуском. Ресурсные точки без производства не дают выпуск.',
                ),
              );
              return;
            }
            const actions = el('div', 'tool-row');
            actions.append(
              button('Показать все', () => this.setAllResourcesVisible(true)),
              button('Скрыть все', () => this.setAllResourcesVisible(false)),
            );
            pane.append(actions);
            const group = createDataGroup('Ресурсы · окрашено / с выпуском', {
              open: expanded,
              onToggle: (open) => (expanded = open),
            });
            for (const item of data.legend) {
              const duplicate = data.legend.some(
                (other) =>
                  other !== item &&
                  other.resource.trim().toLowerCase() === item.resource.trim().toLowerCase(),
              );
              const label = item.resource + (duplicate ? ' · ' + item.unit : ''),
                card = el('div', 'resource-legend-item');
              card.dataset.enabled = String(item.enabled);
              const toggle = createSwitch(
                label,
                (checked) => this.setResourceVisible(item.key, checked),
                {
                  checked: item.enabled,
                  className: 'wide resource-legend-toggle',
                  title: 'Показывать ресурс: ' + label,
                },
              );
              toggle.setAttribute('aria-label', 'Показывать ресурс: ' + label);
              const row = createDataRow(
                label,
                item.count.toLocaleString('ru-RU') +
                  ' / ' +
                  item.producingCount.toLocaleString('ru-RU'),
                { id: item.key },
              );
              const swatch = el('span', 'resource-legend-swatch');
              swatch.style.backgroundColor = item.color;
              swatch.setAttribute('aria-hidden', 'true');
              row.querySelector('.data-name').prepend(swatch);
              toggle.replaceChildren(row);
              card.append(toggle);
              card.append(
                createDataRow(
                  'Мин. — макс.',
                  format(item.min) + ' — ' + format(item.max) + ' ' + item.unit,
                ),
              );
              card.append(
                root.AtlasUI.controls.createColorScale(item.colorScale, {
                  label: 'Градации ресурса: ' + label,
                  formatValue: shortFormat,
                }),
              );
              group.body.append(card);
            }
            pane.append(group.element);
          };
          this.on('change', draw, { signal: scope.signal });
          draw();
        },
      });
    }
  }
  const api = { ResourceOverlay, drawResourceRichness };
  Object.assign((root.AtlasExtensions ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
