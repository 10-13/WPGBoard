/* Time zones are game metadata; the UTC clock, pinned places and overlays are local views. */
(function (root) {
  'use strict';
  const { GeographyLayer, utcTime, localTime, offsetLabel, solarElevation } = root.AtlasExtensions;
  const format = (value) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  class GeographyTimeUI {
    constructor(ctx, model) {
      this.ctx = ctx;
      this.model = model;
      this.zones = new GeographyLayer(ctx, model, 'timezones');
      this.daylight = new GeographyLayer(ctx, model, 'daylight');
      try {
        utcTime(this.daylight.options.utc);
      } catch (_) {
        this.setUTC(this.defaultUTC());
      }
      this.selectedId = ctx.ui.viewport.selectedId;
      ctx.windowMenu({ id: 'time', label: 'География: время', handler: () => this.open() });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'time',
        path: ['Мир', 'География'],
        label: 'Время',
        order: 30,
        handler: () => this.open(),
      });
      ctx.menu(ctx.ui.tileMenu, {
        id: 'time',
        path: ['Провинция', 'География'],
        label: 'Время и часовой пояс',
        handler: (id) => this.open(id),
      });
    }
    defaultUTC() {
      const date = this.ctx.state.meta.geography?.referenceDate;
      try {
        return utcTime(
          (typeof date === 'string' ? date.slice(0, 10) : '1936-01-01') + 'T12:00:00Z',
        );
      } catch (_) {
        return utcTime('1936-01-01T12:00:00Z');
      }
    }
    readUTC() {
      try {
        return utcTime(this.daylight.options.utc ?? this.defaultUTC());
      } catch (_) {
        return this.defaultUTC();
      }
    }
    setUTC(value) {
      const ms = utcTime(value);
      this.daylight.setOptions({ utc: new Date(ms).toISOString() });
    }
    pinned() {
      const ids = this.daylight.options.pinnedProvinceIds;
      return Array.isArray(ids)
        ? [...new Set(ids)].filter(
            (id) => Number.isInteger(id) && this.ctx.state.regionIndex.get(id),
          )
        : [];
    }
    name(id) {
      const name = this.ctx.state.meta.nations?.names?.[id];
      return (name ? name + ' · ' : '') + '#' + id;
    }
    open(regionId = this.ctx.ui.viewport.selectedId) {
      this.selectedId = regionId;
      const { ctx } = this,
        { el, field } = root.AtlasUI.dom,
        { button, createSwitch, createTextInput, createNumberInput } = root.AtlasUI.components,
        { createDataRow, createDataGroup } = root.AtlasUI.dataView;
      return ctx.window({
        id: 'time',
        title: 'География: время',
        x: 355,
        y: 35,
        width: 360,
        height: 600,
        render: (pane, scope, tab) => {
          pane.classList.add('atlas-data-scope');
          const error = el('p', 'form-error'),
            zoneSwitch = createSwitch(
              'Оверлей временных поясов',
              (checked) => this.zones.overlay.setVisible(checked),
              { className: 'wide' },
            ),
            daylightSwitch = createSwitch(
              'Оверлей дня и ночи',
              (checked) => this.daylight.overlay.setVisible(checked),
              { className: 'wide' },
            ),
            utc = el('input'),
            utcRow = createDataRow('Время UTC', ''),
            current = createDataGroup('Выбранная провинция', { open: true }),
            currentData = el('div'),
            editor = createDataGroup('Изменить часовой пояс', { open: false }),
            offset = createNumberInput({ min: -840, max: 840, step: 1 }),
            zoneName = createTextInput({ maxLength: 100 }),
            editorTarget = el('p', 'muted'),
            pins = createDataGroup('Местное время', { open: true }),
            clockRows = el('div'),
            legend = createDataGroup('Легенда временных поясов', { open: false }),
            daylightLegend = createDataGroup('Легенда дня и ночи', { open: true });
          let timer = null,
            editTarget = null,
            editMetadata = null;
          const report = (fn) => {
            try {
              const result = fn();
              error.textContent = '';
              error.hidden = true;
              return result;
            } catch (e) {
              error.textContent = e.message;
              error.hidden = false;
              return undefined;
            }
          };
          error.hidden = true;
          utc.type = 'datetime-local';
          utc.min = '1800-01-01T00:00';
          utc.max = '2200-12-31T23:59';
          utc.step = '60';
          utc.setAttribute('aria-label', 'Дата и время UTC');
          utc.onchange = () =>
            report(() => {
              if (!utc.value || !utc.checkValidity())
                throw new Error('Укажите дату и время UTC между 1800 и 2200 годами.');
              this.setUTC(utc.value + 'Z');
            });
          const stop = () => {
            if (timer !== null) clearInterval(timer);
            timer = null;
            play.checked = false;
          };
          const step = (minutes) => report(() => this.setUTC(this.readUTC() + minutes * 60000));
          const play = createSwitch(
            'Ход времени: +1 мин/с',
            (checked) => {
              stop();
              if (!checked) return;
              play.checked = true;
              timer = setInterval(() => {
                const result = report(() => {
                  const next = this.readUTC() + 60000;
                  this.setUTC(next);
                  return true;
                });
                if (!result) stop();
              }, 1000);
            },
            { className: 'wide' },
          );
          scope.defer(stop);
          const previous = button('−1 час', () => step(-60)),
            next = button('+1 час', () => step(60)),
            stepButtons = el('div', 'form-actions');
          stepButtons.append(previous, next);
          const save = button(
            'Сохранить пояс',
            () =>
              report(() => {
                const ids = ctx.ui.regionSelection.ids,
                  targets = ids.length ? [...ids] : this.selectedId ? [this.selectedId] : [],
                  minutes = Number(offset.value);
                if (!targets.length) throw new Error('Выберите провинцию или несколько провинций.');
                if (!offset.value.trim() || !Number.isInteger(minutes) || Math.abs(minutes) > 840)
                  throw new Error('Смещение задаётся целыми минутами от −840 до +840.');
                const label = zoneName.value.trim();
                if (!label) throw new Error('Укажите название пояса.');
                this.model.update(targets, {
                  'time.offsetMinutes': minutes,
                  'time.zoneName': label,
                });
              }),
            { className: 'wide' },
          );
          editor.body.append(
            editorTarget,
            field('Смещение от UTC, минут', offset),
            field('Название пояса', zoneName),
            save,
            el(
              'p',
              'muted',
              'Смещение и название — свойства игры: сохраняются в истории. Сезонный перевод часов автоматически не применяется.',
            ),
          );
          const add = button(
            'Добавить выбранные места',
            () => {
              const ids = ctx.ui.regionSelection.ids,
                selected = ids.length ? ids : this.selectedId ? [this.selectedId] : [];
              this.daylight.setOptions({
                pinnedProvinceIds: [...new Set([...this.pinned(), ...selected])],
              });
            },
            { className: 'wide' },
          );
          pins.body.append(add, clockRows);
          for (const [label, value, color] of [
            ['День', 'Жёлтый, светлая сторона', 'rgba(255,218,77,.2)'],
            ['Сумерки', 'Переход между днём и ночью', 'rgba(140,134,106,.32)'],
            ['Ночь', 'Синий, тёмная сторона', 'rgba(24,49,135,.43)'],
          ]) {
            const row = createDataRow(label, value),
              swatch = el('span', 'resource-legend-swatch');
            swatch.style.backgroundColor = color;
            swatch.setAttribute('aria-hidden', 'true');
            row.querySelector('.data-name').prepend(swatch);
            daylightLegend.body.append(row);
          }
          daylightLegend.body.append(
            el(
              'p',
              'muted',
              'Освещение рассчитано для центра провинции по дате и UTC. Слои полупрозрачны. UTC и список мест сохраняются только в этом браузере.',
            ),
          );
          pane.append(
            zoneSwitch,
            daylightSwitch,
            field('Дата и время UTC', utc),
            utcRow,
            stepButtons,
            play,
            error,
            current.element,
            editor.element,
            pins.element,
            daylightLegend.element,
            legend.element,
          );
          current.body.append(currentData);
          const update = () => {
            const ms = this.readUTC(),
              id = this.selectedId,
              stats = id ? this.model.read(id) : null;
            zoneSwitch.checked = this.zones.overlay.visible;
            daylightSwitch.checked = this.daylight.overlay.visible;
            if (document.activeElement !== utc) utc.value = new Date(ms).toISOString().slice(0, 16);
            utcRow.querySelector('.data-value').textContent = new Date(ms)
              .toISOString()
              .slice(0, 16)
              .replace('T', ' ');
            currentData.replaceChildren();
            if (!id) currentData.append(el('p', 'muted', 'Выберите провинцию на карте.'));
            else {
              currentData.append(createDataRow('Провинция', this.name(id)));
              if (Number.isInteger(stats?.['time.offsetMinutes'])) {
                currentData.append(
                  createDataRow('Местное время', localTime(ms, stats['time.offsetMinutes'])),
                  createDataRow('Смещение', offsetLabel(stats['time.offsetMinutes'])),
                  createDataRow('Пояс', stats['time.zoneName'] || 'Без названия'),
                );
              } else
                currentData.append(
                  el('p', 'muted', 'Часовой пояс не задан. Его можно назначить ниже.'),
                );
              if (Number.isFinite(stats?.['geo.lat']) && Number.isFinite(stats?.['geo.lon'])) {
                const elevation = solarElevation(ms, stats['geo.lat'], stats['geo.lon']);
                currentData.append(
                  createDataRow('Высота Солнца', format(elevation) + '°'),
                  createDataRow(
                    'Освещение',
                    elevation >= 0 ? 'День' : elevation >= -12 ? 'Сумерки' : 'Ночь',
                  ),
                );
              }
            }
            const targets = ctx.ui.regionSelection.ids,
              targetKey = (targets.length ? targets : id ? [id] : []).join(','),
              firstStats = this.model.read(targets[0] || id),
              metadataKey = JSON.stringify([
                firstStats?.['time.offsetMinutes'],
                firstStats?.['time.zoneName'],
              ]);
            editorTarget.textContent =
              targets.length > 1
                ? 'Будет изменено провинций: ' + targets.length
                : id
                  ? 'Будет изменена провинция: ' + this.name(id)
                  : 'Выберите провинцию.';
            save.disabled = !targetKey;
            add.disabled = !targetKey;
            if (editTarget !== targetKey || editMetadata !== metadataKey) {
              editTarget = targetKey;
              editMetadata = metadataKey;
              offset.value = String(firstStats?.['time.offsetMinutes'] ?? 0);
              zoneName.value = firstStats?.['time.zoneName'] || offsetLabel(0);
            }
            clockRows.replaceChildren();
            const pinned = this.pinned();
            if (!pinned.length)
              clockRows.append(el('p', 'muted', 'Добавьте места, чтобы сравнивать местное время.'));
            for (const pin of pinned) {
              const data = this.model.read(pin),
                value = Number.isInteger(data?.['time.offsetMinutes'])
                  ? localTime(ms, data['time.offsetMinutes']) +
                    ' · ' +
                    offsetLabel(data['time.offsetMinutes'])
                  : 'Пояс не задан',
                row = createDataRow(this.name(pin), value),
                remove = button(
                  '×',
                  () =>
                    this.daylight.setOptions({
                      pinnedProvinceIds: this.pinned().filter((item) => item !== pin),
                    }),
                  { title: 'Убрать ' + this.name(pin) + ' из местного списка' },
                );
              row.querySelector('.data-value').append(' ', remove);
              clockRows.append(row);
            }
            legend.body.replaceChildren();
            const data = this.zones.ensure();
            for (const [minutes, count] of [...data.counts].sort(([a], [b]) => a - b)) {
              const row = createDataRow(offsetLabel(minutes), format(count) + ' провинций'),
                swatch = el('span', 'resource-legend-swatch'),
                province = [...data.values].find(([, value]) => value === minutes)?.[0];
              swatch.style.backgroundColor = data.colors.get(province) || 'transparent';
              swatch.setAttribute('aria-hidden', 'true');
              row.querySelector('.data-name').prepend(swatch);
              legend.body.append(row);
            }
            if (!data.counts.size)
              legend.body.append(
                el(
                  'p',
                  'muted',
                  'Часовые пояса ещё не заполнены. Мир → География → Данные и источники.',
                ),
              );
          };
          const select = (event) => {
            this.selectedId = event.id;
            update();
          };
          tab.onRegionClick(select);
          ctx.ui.input.on(
            'selection:change',
            (event) => {
              if (!event.fromClick) select(event);
            },
            { signal: scope.signal },
          );
          ctx.ui.regionSelection.on('change', update, { signal: scope.signal });
          ctx.ui.on(
            'map:ready',
            () => {
              stop();
              this.selectedId = ctx.ui.viewport.selectedId;
              editTarget = editMetadata = null;
              update();
            },
            { signal: scope.signal },
          );
          this.zones.on('change', update, { signal: scope.signal });
          this.daylight.on('change', update, { signal: scope.signal });
          update();
        },
      });
    }
  }
  Object.assign((root.AtlasExtensions ||= {}), { GeographyTimeUI });
  if (typeof module !== 'undefined' && module.exports) module.exports = { GeographyTimeUI };
})(globalThis);
