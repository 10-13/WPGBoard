/* Ordinary resource overlay and its compact legend; visibility lives in the registry. */
(function (root) {
  'use strict';
  const { EventBus, equal } = root.AtlasCore;
  const { resourceRichness } = root.AtlasExtensions;
  function drawResourceRichness(context, index, data) {
    context.clearRect(0, 0, index.width, index.height); context.imageSmoothingEnabled = false;
    for (const [id, winner] of data.winners) {
      context.fillStyle = winner.color;
      index.forEachRun(id, (start, length) => context.fillRect(start % index.width, Math.floor(start / index.width), length, 1));
    }
  }
  class ResourceOverlay extends EventBus {
    constructor(ctx) {
      super(); this.ctx = ctx; this.dirty = true; this.data = { legend: [], winners: new Map() }; this.message = '';
      this.overlay = ctx.overlay({ id: 'richness', title: 'Богатство ресурсов', order: 15, visible: false });
      const refresh = () => { if (ctx.signal.aborted) return; this.dirty = true; this.painted = null; this.draw(); this.emit('change', {}); };
      ctx.state.on('change', ({ before, after }) => { if (!equal(before.meta.tiles, after.meta.tiles) || !equal(before.meta.resources?.catalog, after.meta.resources?.catalog)) refresh(); }, { signal: ctx.signal });
      ctx.ui.on('map:ready', refresh, { signal: ctx.signal });
      ctx.state.statistics.on('change', refresh, { signal: ctx.signal });
      ctx.state.overlays.on('change', () => { if (!ctx.signal.aborted) { this.draw(); this.emit('change', {}); } }, { signal: ctx.signal });
      ctx.scope.defer(() => { this.data = { legend: [], winners: new Map() }; this.painted = null; });
      ctx.windowMenu({ id: 'resource-legend', label: 'Легенда ресурсов', handler: () => this.open() });
      ctx.menu(ctx.ui.mainMenu, { id: 'resource-legend', path: ['Мир', 'Ресурсы'], label: 'Легенда ресурсов', handler: () => this.open() });
      ctx.ui.registerTooltip('resources:richness', event => {
        const winner = this.overlay.visible ? this.data.winners.get(event.id) : null;
        return winner ? 'Главный ресурс: ' + winner.resource + ' · ' + winner.amount.toLocaleString('ru-RU', { maximumFractionDigits: 4 }) + ' ' + winner.unit : '';
      }, { signal: ctx.signal }); this.draw();
    }
    ensure() {
      if (!this.dirty) return this.data;
      this.dirty = false; this.message = '';
      try {
        const report = this.ctx.state.statistics.calculate([...this.ctx.state.regions.keys()]), block = report.get('resources');
        if (!block) throw new Error(report.errors.find(e => e.id === 'resources')?.message || 'Сборщик ресурсов недоступен.');
        this.data = resourceRichness(block, this.ctx.state.meta.resources?.catalog);
        if (block.invalid.length) this.message = 'Пропущено некорректных ресурсных записей: ' + block.invalid.length + '.';
      } catch (error) { this.data = { legend: [], winners: new Map() }; this.message = 'Не удалось рассчитать ресурсы: ' + error.message; }
      return this.data;
    }
    draw() {
      if (!this.ctx.ui.viewport.ready || !this.overlay.visible) return;
      const data = this.ensure(); if (this.painted === data) return;
      drawResourceRichness(this.overlay.context, this.ctx.state.regionIndex, data); this.painted = data;
    }
    open() {
      const { ctx } = this;
      const { el } = root.AtlasUI.dom, { createSwitch } = root.AtlasUI.controls;
      const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
      return ctx.window({ id: 'resource-legend', title: 'Легенда ресурсов', x: 295, y: 35, width: 310, height: 490, render: (pane, scope) => {
        pane.classList.add('atlas-data-scope'); let expanded = true;
        const draw = () => {
          const data = this.ensure(); pane.replaceChildren();
          pane.append(createSwitch('Оверлей ресурсов', checked => this.overlay.setVisible(checked), { checked: this.overlay.visible, className: 'wide', title: 'Включить или выключить оверлей «Богатство ресурсов»' }));
          pane.append(el('p', 'muted', 'Цвет — ресурс с наибольшим местным максимальным выпуском, с бонусами и до расходов сырья.'));
          pane.append(el('p', 'muted', 'Цвет каждого ресурса постоянный. При равном выпуске выбирается первый ресурс.'));
          pane.append(el('p', 'muted', 'Верхний пиксельный блок — производства, нижний — улучшения. Один пиксель на объект; общий бонус — белый. Между блоками зазор 1 пиксель.'));
          pane.append(createDataRow('Окрашено провинций', data.winners.size.toLocaleString('ru-RU')), createDataRow('Без выпуска', (ctx.state.regions.size - data.winners.size).toLocaleString('ru-RU')));
          if (this.message) pane.append(el('p', 'form-error', this.message));
          if (!data.legend.length) { pane.append(el('p', 'muted', 'Нет производств с положительным выпуском. Ресурсные точки без производства не дают выпуск.')); return; }
          const group = createDataGroup('Ресурсы · число провинций', { open: expanded, onToggle: open => expanded = open });
          for (const item of data.legend) {
            const duplicate = data.legend.some(other => other !== item && other.resource.trim().toLowerCase() === item.resource.trim().toLowerCase());
            const row = createDataRow(item.resource + (duplicate ? ' · ' + item.unit : ''), item.count.toLocaleString('ru-RU'), { id: item.key });
            const swatch = el('span', 'resource-legend-swatch'); swatch.style.backgroundColor = item.color; swatch.setAttribute('aria-hidden', 'true');
            row.querySelector('.data-name').prepend(swatch); group.body.append(row);
          }
          pane.append(group.element);
        };
        this.on('change', draw, { signal: scope.signal }); draw();
      } });
    }
  }
  const api = { ResourceOverlay, drawResourceRichness };
  Object.assign(root.AtlasExtensions ||= {}, api); if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
