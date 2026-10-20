/* Ordinary resource-point overlay and a passive, tab-owned inspector. */
(function (root) {
  'use strict';
  const { EventBus, equal } = root.AtlasCore;
  const {
    collectResourceBonusSources,
    projectResourceBonuses,
    drawResourceBonusHatching,
    RESOURCE_BONUSES: bonuses,
    RESOURCE_ACTIVITIES: activities,
  } = root.AtlasExtensions;
  const empty = () => ({ legend: [], byProvince: new Map(), pointCount: 0, invalid: [] });
  const format = (n) => n.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
  const resourceName = (resource) => (resource === '*' ? 'Все ресурсы' : resource);
  const globalBonus = (type) =>
    ['production-flat', 'total-percent'].includes(type) || type.startsWith('global-');
  function bonusText(bonus, point) {
    return (
      format(bonus.value) +
      (bonuses[bonus.type].percent
        ? ' %'
        : ' ' +
          (bonuses[bonus.type].efficiency
            ? bonus.inputUnit === '*'
              ? 'ед. сырья'
              : bonus.inputUnit
            : point.unit === '*'
              ? 'ед. выпуска'
              : point.unit))
    );
  }
  class ResourceBonusOverlay extends EventBus {
    constructor(ctx) {
      super();
      this.ctx = ctx;
      this.dirty = true;
      this.data = empty();
      this.selectedId = ctx.ui.viewport.selectedId;
      this.overlay = ctx.overlay({
        id: 'bonuses',
        title: 'Ресурсные точки',
        order: 18,
        visible: false,
      });
      this.options = this.readOptions();
      const refresh = () => {
        if (ctx.signal.aborted) return;
        this.dirty = true;
        this.painted = null;
        this.draw();
        this.emit('change', {});
      };
      ctx.state.on(
        'change',
        ({ before, after }) => {
          if (
            !equal(before.meta.tiles, after.meta.tiles) ||
            !equal(before.meta.resources?.catalog, after.meta.resources?.catalog)
          )
            refresh();
        },
        { signal: ctx.signal },
      );
      ctx.ui.on(
        'map:ready',
        () => {
          this.selectedId = ctx.ui.viewport.selectedId;
          refresh();
        },
        { signal: ctx.signal },
      );
      ctx.state.overlays.on(
        'change',
        () => {
          this.draw();
          this.emit('change', {});
        },
        { signal: ctx.signal },
      );
      ctx.state.overlays.on(
        'settings:change',
        () => {
          const options = this.readOptions();
          if (equal(options, this.options)) return;
          this.options = options;
          this.project();
          this.draw();
          this.emit('change', {});
        },
        { signal: ctx.signal },
      );
      ctx.scope.defer(() => {
        this.sources = null;
        this.data = empty();
        this.painted = null;
      });
      ctx.windowMenu({
        id: 'bonus-legend',
        label: 'Ресурсные точки и бонусы',
        handler: () => this.open(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'bonus-legend',
        path: ['Мир', 'Ресурсы'],
        label: 'Ресурсные точки и бонусы',
        handler: () => this.open(),
      });
      ctx.ui.registerTooltip(
        'resources:bonuses',
        (event) => {
          const points = this.overlay.visible ? this.data.byProvince.get(event.id)?.points : null;
          return points?.length
            ? 'Ресурсные точки: ' +
                points
                  .map(
                    (point) =>
                      point.title +
                      ' — ' +
                      point.bonuses
                        .map((b) => bonuses[b.type].label + ': ' + bonusText(b, point))
                        .join('; '),
                  )
                  .join(' · ')
            : '';
        },
        { signal: ctx.signal },
      );
      this.draw();
    }
    readOptions() {
      const value = this.ctx.state.overlays.getOptions(this.overlay.id);
      return {
        resource: typeof value.resource === 'string' ? value.resource : '',
        type: Object.hasOwn(bonuses, value.type) ? value.type : '',
      };
    }
    setOptions(changes) {
      this.ctx.state.overlays.setOptions(this.overlay.id, {
        ...this.ctx.state.overlays.getOptions(this.overlay.id),
        ...this.options,
        ...changes,
      });
    }
    project() {
      if (!this.sources || this.dirty) return;
      this.data = projectResourceBonuses(
        this.sources,
        this.options,
        this.ctx.state.meta.resources?.catalog,
      );
      this.painted = null;
    }
    ensure() {
      if (this.dirty) {
        this.sources = collectResourceBonusSources(
          this.ctx.state.meta.tiles,
          this.ctx.state.regionIndex,
        );
        this.dirty = false;
        this.project();
      }
      return this.data;
    }
    draw() {
      if (!this.ctx.ui.viewport.ready || !this.overlay.visible) return;
      const data = this.ensure();
      if (data === this.painted) return;
      drawResourceBonusHatching(this.overlay.context, this.ctx.state.regionIndex, data);
      this.painted = data;
    }
    open() {
      const { ctx } = this,
        { el, field } = root.AtlasUI.dom,
        { createSwitch, button } = root.AtlasUI.controls,
        { createDataRow, createDataGroup } = root.AtlasUI.dataView;
      this.selectedId = ctx.ui.viewport.selectedId;
      return ctx.window({
        id: 'bonus-legend',
        title: 'Ресурсные точки и бонусы',
        x: 310,
        y: 35,
        width: 360,
        height: 540,
        render: (pane, scope, tab) => {
          pane.classList.add('atlas-data-scope');
          const expanded = new Map();
          const draw = () => {
            const data = this.ensure(),
              scrollTop = pane.scrollTop;
            pane.replaceChildren();
            pane.append(
              createSwitch(
                'Оверлей ресурсных точек',
                (checked) => this.overlay.setVisible(checked),
                { checked: this.overlay.visible, className: 'wide' },
              ),
            );
            pane.append(
              el(
                'p',
                'muted',
                'Штриховка отмечает провинции с ресурсными точками. Цвет — ресурс, белый — общий бонус. Несколько цветов чередуются.',
              ),
            );
            const resource = document.createElement('select');
            resource.setAttribute('aria-label', 'Ресурс бонусных точек');
            resource.append(
              new Option('Все ресурсные точки', ''),
              new Option('Только общие бонусы', '*'),
            );
            for (const item of this.sources.resources)
              resource.append(new Option(item.name + ' + общие', item.key));
            if (
              this.options.resource &&
              this.options.resource !== '*' &&
              !this.sources.resources.some((item) => item.key === this.options.resource)
            )
              resource.append(
                new Option(this.options.resource + ' · нет точек', this.options.resource),
              );
            resource.value = this.options.resource;
            resource.onchange = () => this.setOptions({ resource: resource.value });
            const type = document.createElement('select');
            type.setAttribute('aria-label', 'Тип бонуса точек');
            type.append(new Option('Все типы бонусов', ''));
            for (const [id, spec] of Object.entries(bonuses))
              type.append(new Option(spec.label, id));
            type.value = this.options.type;
            type.onchange = () => this.setOptions({ type: type.value });
            pane.append(
              field('Ресурс', resource),
              field('Бонус', type),
              createDataRow('Ресурсных точек', format(data.pointCount)),
              createDataRow('Провинций', format(data.byProvince.size)),
            );
            pane.append(
              el(
                'p',
                'muted',
                'Глобальные бонусы отмечены у источника; действуют на весь набор регионов при расчёте. Штриховка не означает итоговый прирост выпуска.',
              ),
            );
            if (data.invalid.length)
              pane.append(el('p', 'form-error', 'Некорректных записей: ' + data.invalid.length));
            const legend = createDataGroup('Ресурсы · точки / провинции', { open: true });
            for (const item of data.legend) {
              const row = createDataRow(
                  resourceName(item.resource),
                  format(item.pointCount) + ' / ' + format(item.provinceCount),
                ),
                swatch = el('span', 'resource-legend-swatch');
              swatch.style.backgroundImage =
                'repeating-linear-gradient(135deg, transparent 0 2px, ' + item.color + ' 2px 3px)';
              swatch.setAttribute('aria-hidden', 'true');
              row.querySelector('.data-name').prepend(swatch);
              legend.body.append(row);
            }
            if (!data.legend.length)
              legend.body.append(el('p', 'muted', 'Нет точек для выбранного фильтра.'));
            pane.append(legend.element);
            const id = this.selectedId,
              points = data.byProvince.get(id)?.points || [],
              name = ctx.state.meta.nations?.names?.[id];
            const selected = createDataGroup(
              id ? 'Провинция #' + id + (name ? ' · ' + name : '') : 'Выбранная провинция',
              { open: true },
            );
            if (!id)
              selected.body.append(
                el(
                  'p',
                  'muted',
                  'Кликните по провинции: здесь появятся её ресурсные точки и бонусы.',
                ),
              );
            else if (!points.length)
              selected.body.append(el('p', 'muted', 'Нет ресурсных точек для выбранного фильтра.'));
            for (const point of points) {
              const key = id + ':' + point.id,
                group = createDataGroup(point.title, {
                  open: expanded.get(key) ?? true,
                  onToggle: (open) => expanded.set(key, open),
                });
              group.body.append(
                createDataRow('Ресурс', resourceName(point.resource)),
                createDataRow('Вид', activities[point.activity] || 'Все виды'),
                createDataRow('Единицы', point.unit === '*' ? 'Любые' : point.unit),
              );
              for (const bonus of point.bonuses) {
                group.body.append(
                  createDataRow(bonuses[bonus.type].label, bonusText(bonus, point)),
                );
                group.body.append(
                  createDataRow(
                    'Действует',
                    globalBonus(bonus.type) ? 'На весь расчётный набор' : 'В этой провинции',
                  ),
                );
                if (bonuses[bonus.type].efficiency)
                  group.body.append(
                    createDataRow(
                      'Расходуемое сырьё',
                      bonus.inputResource === '*' ? 'Все ресурсы' : bonus.inputResource,
                    ),
                  );
              }
              if (point.description)
                group.body.append(el('p', 'metadata-description', point.description));
              selected.body.append(group.element);
            }
            if (id && ctx.ui.extensions.isEnabled('metadata'))
              selected.body.append(
                button('Метаданные провинции', () =>
                  ctx.ui.emit('metadata:open', { regionId: id }),
                ),
              );
            pane.append(selected.element);
            pane.scrollTop = scrollTop;
          };
          const select = (event) => {
            this.selectedId = event.id;
            draw();
          };
          tab.onRegionClick(select);
          ctx.ui.input.on(
            'selection:change',
            (event) => {
              if (!event.fromClick) select(event);
            },
            { signal: scope.signal },
          );
          this.on('change', draw, { signal: scope.signal });
          draw();
        },
      });
    }
  }
  Object.assign((root.AtlasExtensions ||= {}), { ResourceBonusOverlay });
  if (typeof module !== 'undefined' && module.exports) module.exports = { ResourceBonusOverlay };
})(globalThis);
