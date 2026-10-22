/* Shared, optional geography maps and tab-owned inspectors. Display choices stay local. */
(function (root) {
  'use strict';
  const { equal } = root.AtlasCore;
  const { SimpleOverlay } =
    typeof module !== 'undefined' && module.exports
      ? require('../packages/ui/simple-overlay.js')
      : root.AtlasUI;
  const {
    GEOGRAPHY_THEMES: themes,
    GEOGRAPHY_TYPES: types,
    GEOGRAPHY_KEYS: keys,
    GEOGRAPHY_MONTHS: months,
    geographyOverlay,
    geographyScale,
    metricValue,
    reliefHatchPeriod,
  } = root.AtlasExtensions;
  const format = (value, digits = 1) =>
    typeof value === 'number' && Number.isFinite(value)
      ? value.toLocaleString('ru-RU', { maximumFractionDigits: digits })
      : 'Нет данных';
  const mainPaths = {
    elevation: ['Мир', 'География', 'Рельеф'],
    relief: ['Мир', 'География', 'Рельеф'],
    terrain: ['Мир', 'География', 'Рельеф'],
    temperature: ['Мир', 'География', 'Климат'],
    pressure: ['Мир', 'География', 'Климат'],
    belts: ['Мир', 'География', 'Климат'],
    precipitation: ['Мир', 'География', 'Климат'],
    soil: ['Мир', 'География', 'Климат'],
    geographic: ['Мир', 'География', 'Климат', 'Пояса и природные зоны'],
    zones: ['Мир', 'География', 'Климат', 'Пояса и природные зоны'],
  };
  const metricNames = [
    ['annual', 'Среднегодовое значение'],
    ['range', 'Сезонный размах'],
    ['winter', 'Зима'],
    ['spring', 'Весна'],
    ['summer', 'Лето'],
    ['autumn', 'Осень'],
    ...months.map((name, i) => ['month-' + i, name]),
  ];
  const labels = {
    'geo.lat': 'Широта, °',
    'geo.lon': 'Долгота, °',
    'terrain.elevation': 'Высота, м',
    'terrain.relief': 'Местный перепад, м',
    'terrain.type': 'Тип местности',
    'climate.temperature.monthly': 'Среднемесячная температура, °C',
    'climate.pressure.monthly': 'Среднемесячное давление у моря, гПа',
    'climate.precipitation.monthly': 'Осадки за месяц, мм',
    'climate.belt': 'Климатический пояс',
    'climate.soil': 'Почвенный тип',
    'climate.geographicBelt': 'Географический пояс',
    'climate.naturalZone': 'Природная зона',
    'time.offsetMinutes': 'Смещение UTC, минут',
    'time.zoneName': 'Название пояса',
  };
  const notes = {
    elevation:
      'Высота и местный перепад взяты из сглаженной глобальной сетки. Значение относится к окрестности центра провинции.',
    relief:
      'Штриховка показывает перепад высот в окрестности центра провинции: разницу максимума и минимума в окне 5 × 5 ячеек сглаженной сетки. Чем больше перепад, тем плотнее штрихи; нулевой перепад прозрачен. Это величина перепада, без направления склонов. Шкала строится по выбранной области.',
    terrain:
      'Обобщённый тип местности по высоте и местному перепаду; игровая классификация, которую можно изменить.',
    temperature:
      'Среднемесячная норма 1970–2000. Размах — разница самого тёплого и самого холодного месяца, без погодных экстремумов. Сезоны соответствуют полушарию провинции.',
    pressure:
      'Среднемесячная норма 1970–2000 у уровня моря. Давление у поверхности рассчитано по высоте и температуре. Сезоны соответствуют полушарию провинции.',
    belts:
      'Обобщённые климатические пояса. Справочные диапазоны приблизительны; фактические средние рассчитаны по провинциям без весов по площади.',
    precipitation:
      'Сумма среднемесячных осадков нормы 1970–2000. Это количество за год, а не прогноз погоды.',
    soil: 'Зональная игровая оценка по климату и рельефу. Это не почвенная съёмка; значения доступны для редактирования.',
    geographic: 'Обобщённые широтные географические пояса; границы условные и редактируемые.',
    zones:
      'Природная зона оценена по климату и рельефу. Это игровая основа, а не карта текущего землепользования.',
  };
  let editorSerial = 0;

  const { createSelect, createTextInput, createNumberInput } =
    typeof module !== 'undefined' && module.exports
      ? require('../packages/ui/components.js')
      : root.AtlasUI.components;
  function nameOf(state, id) {
    return '#' + id + (state.meta.nations?.names?.[id] ? ' · ' + state.meta.nations.names[id] : '');
  }
  function selectedIds(ctx, selectedId) {
    const ids = ctx.ui.regionSelection.ids;
    return ids.length ? [...ids] : selectedId ? [selectedId] : [];
  }
  function categoryRow(label, value, color) {
    const row = root.AtlasUI.dataView.createDataRow(label, value);
    if (color) {
      const swatch = root.AtlasUI.dom.el('span', 'resource-legend-swatch');
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-hidden', 'true');
      row.querySelector('.data-name').prepend(swatch);
    }
    return row;
  }

  // The same controller is used by the time extension. Unknown local options are preserved.
  class GeographyLayer extends SimpleOverlay {
    constructor(ctx, model, theme) {
      if (!themes[theme]) throw new Error('Неизвестный оверлей географии: ' + theme);
      super(ctx, {
        ...geographyOverlay(theme),
        id: theme,
        title: themes[theme].title,
        order: 25 + Object.keys(themes).indexOf(theme),
        visible: false,
        lazy: true,
        watch: (before, after) =>
          !equal(before.meta.tiles, after.meta.tiles) ||
          !equal(before.meta.geography, after.meta.geography),
      });
      this.model = model;
      this.theme = theme;
      ctx.ui.overlayAreas?.on('change', () => this.emit('change', {}), { signal: ctx.signal });
    }
    ensure() {
      return super.ensure().state;
    }
    get data() {
      return (
        this.result?.state || {
          values: new Map(),
          colors: new Map(),
          counts: new Map(),
          min: 0,
          max: 0,
        }
      );
    }
  }

  function openGeographyEditor(ctx, model, provinceIds, editKeys, title) {
    const { el, field } = root.AtlasUI.dom;
    const { button, createSwitch } = root.AtlasUI.controls;
    const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
    const ids = [...new Set(provinceIds)].filter((id) => ctx.state.regionIndex.get(id));
    if (!ids.length) {
      ctx.ui.notify('Выберите провинцию или несколько провинций на карте.');
      return null;
    }
    const mapId = ctx.state.map.id;
    const first = model.read(ids[0]) || {};
    return ctx.window({
      id: 'geography-edit:' + ++editorSerial,
      title: 'Изменить: ' + title,
      x: 330,
      y: 55,
      width: 360,
      height: 460,
      render(pane, scope, tab) {
        pane.classList.add('atlas-data-scope');
        const form = el('form');
        const fields = [];
        const error = el('p', 'form-error');
        form.append(
          createDataRow('Провинций', String(ids.length)),
          el(
            'p',
            'muted',
            ids.length === 1
              ? nameOf(ctx.state, ids[0])
              : 'Используется выделение на момент открытия. Включите только изменяемые параметры; сохранённые значения будут общими для всего набора.',
          ),
        );
        if (editKeys.includes('climate.pressure.monthly'))
          form.append(
            el(
              'p',
              'muted',
              'Редактируется давление у уровня моря. Давление у поверхности пересчитывается из него, высоты и температуры.',
            ),
          );
        for (const key of editKeys) {
          const spec = keys[key];
          const original = first[key];
          const toggle = createSwitch('Изменить: ' + labels[key], () => {}, {
            checked: ids.length === 1 && original !== undefined,
            className: 'wide',
          });
          const inputs = [];
          const makeInput = (value, label, numeric = true) => {
            const options = {
              value: value ?? '',
              label,
              onInput: () => {
                toggle.checked = true;
              },
            };
            const input = numeric
              ? createNumberInput({
                  ...options,
                  min: spec[0],
                  max: spec[1],
                  step: key === 'time.offsetMinutes' ? '1' : 'any',
                })
              : createTextInput({ ...options, maxLength: 100 });
            inputs.push(input);
            return input;
          };
          if (Array.isArray(spec) && spec[2]) {
            const group = createDataGroup(labels[key], { open: true });
            group.body.append(toggle);
            for (let i = 0; i < 12; i++)
              group.body.append(
                field(months[i], makeInput(original?.[i], months[i] + ' · ' + labels[key])),
              );
            form.append(group.element);
          } else {
            form.append(toggle);
            if (Array.isArray(spec) || spec === 'text')
              form.append(field(labels[key], makeInput(original, labels[key], spec !== 'text')));
            else {
              const input = createSelect(
                [
                  ['', 'Выберите значение'],
                  ...Object.entries(types[spec]).map(([id, type]) => [id, type.label]),
                ],
                () => {
                  toggle.checked = true;
                },
                { value: original || '', label: labels[key] },
              );
              inputs.push(input);
              form.append(field(labels[key], input));
            }
          }
          fields.push({ key, spec, toggle, inputs });
        }
        const save = button('Сохранить изменения', () => {}, { className: 'accent wide' });
        save.type = 'submit';
        form.append(error, save);
        form.onsubmit = (event) => {
          event.preventDefault();
          error.textContent = '';
          try {
            if (ctx.state.map.id !== mapId)
              throw new Error('Карта изменилась. Откройте форму заново.');
            const patch = {};
            for (const item of fields) {
              if (!item.toggle.checked) continue;
              if (item.inputs.some((input) => input.value.trim() === ''))
                throw new Error('Заполните параметр: ' + labels[item.key]);
              const values = item.inputs.map((input) =>
                Array.isArray(item.spec) ? Number(input.value) : input.value.trim(),
              );
              patch[item.key] = item.spec[2] && Array.isArray(item.spec) ? values : values[0];
            }
            if (!Object.keys(patch).length)
              throw new Error('Включите хотя бы один изменяемый параметр.');
            model.update(ids, patch);
            tab.close();
          } catch (exception) {
            error.textContent = exception.message;
          }
        };
        ctx.state.on(
          'map:loaded',
          () => {
            if (ctx.state.map.id !== mapId) tab.close();
          },
          { signal: scope.signal },
        );
        pane.append(form);
      },
    });
  }

  class GeographyThemeUI extends GeographyLayer {
    constructor(ctx, model, theme, { path = mainPaths[theme], registerMenus = true } = {}) {
      super(ctx, model, theme);
      this.selectedId = ctx.ui.viewport.selectedId;
      if (theme === 'relief')
        ctx.ui.on(
          'geography:relief:open',
          (event) => {
            if (event && Object.hasOwn(event, 'provinceIds'))
              this.setOptions({ provinceIds: event.provinceIds });
            this.open();
          },
          { signal: ctx.signal },
        );
      if (registerMenus) {
        ctx.windowMenu({ id: theme, label: themes[theme].title, handler: () => this.open() });
        ctx.menu(ctx.ui.mainMenu, {
          id: theme + ':open',
          path,
          order: 10 + Object.keys(themes).indexOf(theme),
          label: themes[theme].title,
          handler: () => this.open(),
        });
        ctx.menu(ctx.ui.tileMenu, {
          id: theme + ':inspect',
          path: ['Провинция', 'География'],
          label: themes[theme].title,
          handler: (id) => this.open(id),
        });
      }
      ctx.ui.registerTooltip(
        this.overlay.id,
        (event) => {
          if (!this.overlay.visible) return '';
          const value = this.ensure().values.get(event.id);
          if (value === undefined) return '';
          const spec = themes[theme];
          return (
            spec.title +
            ': ' +
            (spec.category
              ? types[spec.category][value]?.label || value
              : format(value) + ' ' + spec.unit)
          );
        },
        { signal: ctx.signal },
      );
    }
    openEditor(ids = selectedIds(this.ctx, this.selectedId)) {
      const theme = this.theme;
      const editKeys =
        theme === 'elevation' ? ['terrain.elevation', 'terrain.relief'] : [themes[theme].key];
      return openGeographyEditor(this.ctx, this.model, ids, editKeys, themes[theme].title);
    }
    renderLegend(pane, data, expanded) {
      const { el } = root.AtlasUI.dom;
      const { button } = root.AtlasUI.controls;
      const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
      const spec = themes[this.theme];
      if (!spec.category) {
        const model =
          data.scale || geographyScale(this.theme, data.min, data.max, this.options.scaleMode);
        pane.append(
          createDataRow(
            'Минимум — максимум в области',
            format(data.min) + ' — ' + format(data.max) + ' ' + spec.unit,
          ),
          root.AtlasUI.controls.createColorScale(model, {
            label: 'Шкала: ' + spec.title,
            onModeChange: (scaleMode) => this.setOptions({ scaleMode }),
            formatValue: (value) => format(value),
            sampleStyle: spec.hatching
              ? (value, color) => {
                  const period = reliefHatchPeriod(value, data.min, data.max);
                  return {
                    backgroundColor: 'transparent',
                    backgroundImage: period
                      ? 'repeating-linear-gradient(135deg, ' +
                        color +
                        ' 0 1px, transparent 1px ' +
                        period +
                        'px)'
                      : 'none',
                  };
                }
              : undefined,
          }),
        );
        return;
      }
      const legend = createDataGroup('Легенда · провинций', {
        open: expanded.get('legend') ?? true,
        onToggle: (open) => expanded.set('legend', open),
      });
      for (const [id, type] of Object.entries(types[spec.category])) {
        const count = data.counts.get(id) || 0;
        if (this.theme === 'belts') {
          const group = createDataGroup(type.label + ' · ' + count, {
            open: expanded.get('belt:' + id) ?? false,
            onToggle: (open) => expanded.set('belt:' + id, open),
          });
          const records = [...data.values]
            .filter(([, value]) => value === id)
            .map(([provinceId]) => this.model.read(provinceId));
          const average = (theme) => {
            const values = records
              .map((stats) => metricValue(stats, theme))
              .filter((value) => typeof value === 'number' && Number.isFinite(value));
            return values.length
              ? values.reduce((sum, value) => sum + value, 0) / values.length
              : null;
          };
          group.body.append(
            categoryRow('Провинций', String(count), type.color),
            createDataRow('Ориентир', type.reference),
            createDataRow('Температура', format(average('temperature')) + ' °C'),
            createDataRow('Осадки', format(average('precipitation'), 0) + ' мм/год'),
          );
          if (count)
            group.body.append(
              button('Выделить пояс', () =>
                this.ctx.ui.regionSelection.replace(
                  [...data.values]
                    .filter(([, value]) => value === id)
                    .map(([provinceId]) => provinceId),
                ),
              ),
            );
          legend.body.append(group.element);
        } else legend.body.append(categoryRow(type.label, String(count), type.color));
      }
      pane.append(legend.element);
    }
    open(id) {
      const { ctx } = this;
      if (Number.isInteger(id)) this.selectedId = id;
      else this.selectedId = ctx.ui.viewport.selectedId;
      this.emit('change', {});
      return ctx.window({
        id: this.theme,
        title: themes[this.theme].title,
        x: 300,
        y: 35,
        width: 360,
        height: 520,
        render: (pane, scope, tab) => {
          const { el, field } = root.AtlasUI.dom;
          const { createSwitch, button } = root.AtlasUI.controls;
          const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
          pane.classList.add('atlas-data-scope');
          const expanded = new Map();
          const draw = () => {
            const scrollTop = pane.scrollTop;
            const data = this.ensure();
            const spec = themes[this.theme];
            pane.replaceChildren(
              createSwitch(
                'Оверлей: ' + spec.title,
                (checked) => this.overlay.setVisible(checked),
                {
                  checked: this.overlay.visible,
                  className: 'wide',
                },
              ),
            );
            if (!spec.category)
              pane.append(
                root.AtlasUI.overlayScope.createScopeControl({
                  state: ctx.state,
                  selection: ctx.ui.regionSelection,
                  areas: ctx.ui.overlayAreas,
                  open: expanded.get('scope') ?? true,
                  onToggle: (open) => expanded.set('scope', open),
                  readIds: () => this.options.provinceIds ?? null,
                  onChange: (provinceIds) => this.setOptions({ provinceIds }),
                }),
              );
            if (this.theme === 'elevation')
              pane.append(
                button(
                  'Перепады высот',
                  () =>
                    ctx.ui.emit('geography:relief:open', {
                      provinceIds: this.options.provinceIds ?? null,
                    }),
                  {
                    className: 'wide',
                    title: 'Открыть отдельный оверлей перепадов высот со штриховкой',
                  },
                ),
              );
            if (spec.monthly) {
              pane.append(
                field(
                  'Показатель',
                  createSelect(metricNames, (metric) => this.setOptions({ metric }), {
                    value: this.options.metric || 'annual',
                    label: 'Показатель: ' + spec.title,
                  }),
                ),
              );
              if (this.theme === 'pressure')
                pane.append(
                  field(
                    'Приведение',
                    createSelect(
                      [
                        ['sea', 'У уровня моря'],
                        ['surface', 'У поверхности'],
                      ],
                      (reference) => this.setOptions({ reference }),
                      { value: this.options.reference || 'sea', label: 'Приведение давления' },
                    ),
                  ),
                );
            }
            pane.append(el('p', 'muted', notes[this.theme]));
            const scopeSize = data.scopeSize ?? ctx.state.regions.size;
            pane.append(
              ...(spec.category ? [createDataRow('Провинций в области', String(scopeSize))] : []),
              createDataRow('Провинций с данными', String(data.values.size)),
              createDataRow('Без данных в области', String(scopeSize - data.values.size)),
            );
            if (data.values.size) this.renderLegend(pane, data, expanded);
            else
              pane.append(
                el(
                  'p',
                  'muted',
                  'В выбранной области нет данных. Измените область или заполните географию в Мир → География → Данные и источники.',
                ),
              );
            const id = this.selectedId;
            const stats = id ? this.model.read(id) : null;
            const group = createDataGroup(
              id ? 'Провинция ' + nameOf(ctx.state, id) : 'Выбранная провинция',
              {
                open: expanded.get('province') ?? true,
                onToggle: (open) => expanded.set('province', open),
              },
            );
            if (!id)
              group.body.append(
                el('p', 'muted', 'Кликните по провинции, чтобы посмотреть её данные.'),
              );
            else {
              const value = metricValue(stats, this.theme, this.options);
              group.body.append(
                createDataRow(
                  spec.title,
                  spec.category
                    ? types[spec.category][value]?.label || 'Нет данных'
                    : format(value) + ' ' + spec.unit,
                ),
              );
              if (this.theme === 'elevation')
                group.body.append(
                  createDataRow('Местный перепад', format(stats?.['terrain.relief']) + ' м'),
                );
              if (spec.monthly && stats?.[spec.key]) {
                for (const [metric, title] of metricNames.slice(0, 6))
                  group.body.append(
                    createDataRow(
                      title,
                      format(metricValue(stats, this.theme, { ...this.options, metric })) +
                        ' ' +
                        spec.unit,
                    ),
                  );
              }
              if (this.theme === 'precipitation' || spec.monthly) {
                const monthly = createDataGroup('По месяцам', {
                  open: expanded.get('months') ?? false,
                  onToggle: (open) => expanded.set('months', open),
                });
                for (let i = 0; i < 12; i++) {
                  const value =
                    this.theme === 'precipitation'
                      ? stats?.[spec.key]?.[i]
                      : metricValue(stats, this.theme, { ...this.options, metric: 'month-' + i });
                  monthly.body.append(
                    createDataRow(
                      months[i],
                      format(value) + ' ' + (this.theme === 'precipitation' ? 'мм' : spec.unit),
                    ),
                  );
                }
                group.body.append(monthly.element);
              }
              group.body.append(
                button('Изменить эту провинцию', () => this.openEditor([id]), {
                  className: 'wide',
                }),
              );
            }
            pane.append(group.element);
            const ids = selectedIds(ctx, id);
            pane.append(
              button('Изменить выделение · ' + ids.length, () => this.openEditor(ids), {
                className: 'wide',
                disabled: !ids.length,
              }),
            );
            pane.scrollTop = scrollTop;
          };
          tab.onRegionClick((event) => {
            this.selectedId = event.id;
            draw();
          });
          ctx.ui.input.on(
            'selection:change',
            (event) => {
              if (!event.fromClick) {
                this.selectedId = event.id;
                draw();
              }
            },
            { signal: scope.signal },
          );
          ctx.ui.regionSelection.on('change', draw, { signal: scope.signal });
          this.on('change', draw, { signal: scope.signal });
          draw();
        },
      });
    }
  }

  class GeographyDataUI {
    constructor(ctx, model, { seed } = {}) {
      this.ctx = ctx;
      this.model = model;
      this.seedSource = seed;
      ctx.windowMenu({
        id: 'geography-data',
        label: 'География: данные и источники',
        handler: () => this.open(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'geography-data',
        path: ['Мир', 'География'],
        label: 'Данные и источники',
        handler: () => this.open(),
      });
      ctx.menu(ctx.ui.mainMenu, {
        id: 'geography-seed',
        path: ['Мир', 'География'],
        label: 'Заполнить отсутствующую географию',
        handler: () => this.applySeed(),
      });
    }
    readSeed() {
      if (typeof this.seedSource === 'function') return this.seedSource();
      if (this.seedSource) return this.seedSource;
      const node = document.getElementById('atlas-geography-seed');
      if (!node?.textContent?.trim())
        throw new Error('В этой странице нет встроенного набора географии.');
      return JSON.parse(node.textContent);
    }
    applySeed() {
      try {
        this.model.seed(this.readSeed());
        this.ctx.ui.notify(
          'Отсутствующие параметры географии заполнены. Существующие значения сохранены.',
        );
      } catch (error) {
        this.ctx.ui.notify(error.message);
      }
    }
    open() {
      const { ctx } = this;
      return ctx.window({
        id: 'geography-data',
        title: 'География: данные и источники',
        x: 295,
        y: 35,
        width: 390,
        height: 540,
        render: (pane, scope, tab) => {
          const { el } = root.AtlasUI.dom;
          const { button } = root.AtlasUI.controls;
          const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
          pane.classList.add('atlas-data-scope');
          let selectedId = ctx.ui.viewport.selectedId;
          const draw = () => {
            const count = [...ctx.state.regions.keys()].filter((id) => this.model.read(id)).length;
            const provenance = ctx.state.meta.geography?.environment;
            pane.replaceChildren(
              createDataRow('Провинций с географией', String(count)),
              createDataRow('Всего провинций', String(ctx.state.regions.size)),
              createDataRow('Климатическая норма', '1970–2000'),
              el(
                'p',
                'muted',
                'География хранится в метаданных провинций и истории игры, переносится вместе с JSON и HTML. Заполнение добавляет отсутствующие параметры и сохраняет ваши правки.',
              ),
              button('Заполнить отсутствующую географию', () => this.applySeed(), {
                className: 'wide',
              }),
              el(
                'p',
                'muted',
                'Климат — глобальная реаналитическая сетка NOAA 20CRv3. Рельеф — сглаженная GMT/SRTM15+. Типы местности, пояса, почвы и природные зоны — редактируемая игровая оценка. Это приблизительные условия провинции, без реконструкции погоды 1936 года.',
              ),
            );
            const sourceGroup = createDataGroup('Источники и методы', { open: true });
            const sources = [
              ['Климат NOAA 20CRv3', 'https://psl.noaa.gov/data/gridded/data.20thC_ReanV3.html'],
              [
                'Рельеф GMT/SRTM15+',
                'https://www.generic-mapping-tools.org/remote-datasets/earth-relief.html',
              ],
              ['Географические названия и пояса GeoNames', 'https://www.geonames.org/'],
            ];
            for (const [label, url] of sources) {
              const link = el('a', '', 'Открыть');
              link.href = url;
              link.target = '_blank';
              link.rel = 'noreferrer';
              const row = createDataRow(label, '');
              row.querySelector('.data-value').append(link);
              sourceGroup.body.append(row);
            }
            if (provenance) {
              sourceGroup.body.append(
                createDataRow('Период нормы', provenance.period || '1970–2000'),
                createDataRow('Пояса зафиксированы на', provenance.referenceDate || '1936-01-01'),
              );
              for (const source of provenance.sources || [])
                if (source.resolution)
                  sourceGroup.body.append(createDataRow(source.title, source.resolution));
              const methods = createDataGroup('Как получены значения', { open: false });
              for (const method of provenance.methods || [])
                methods.body.append(el('p', 'metadata-description', method));
              sourceGroup.body.append(methods.element);
            } else
              sourceGroup.body.append(
                el('p', 'muted', 'Источник конкретного набора появится после заполнения.'),
              );
            pane.append(sourceGroup.element);
            const ids = selectedIds(ctx, selectedId);
            const stats = selectedId ? this.model.read(selectedId) : null;
            const selected = createDataGroup(
              selectedId ? 'Провинция ' + nameOf(ctx.state, selectedId) : 'Координаты провинции',
              { open: true },
            );
            selected.body.append(
              createDataRow('Широта', format(stats?.['geo.lat'], 4)),
              createDataRow('Долгота', format(stats?.['geo.lon'], 4)),
              button(
                'Изменить координаты выделения · ' + ids.length,
                () =>
                  openGeographyEditor(ctx, this.model, ids, ['geo.lat', 'geo.lon'], 'Координаты'),
                { className: 'wide', disabled: !ids.length },
              ),
            );
            pane.append(
              selected.element,
              el(
                'p',
                'muted',
                'Настройки оверлеев и интерактивное UTC-время локальны: они не создают действий истории. Пояса провинций — игровые данные; автоматический переход на летнее время не применяется.',
              ),
            );
          };
          tab.onRegionClick((event) => {
            selectedId = event.id;
            draw();
          });
          ctx.ui.regionSelection.on('change', draw, { signal: scope.signal });
          ctx.state.on('change', draw, { signal: scope.signal });
          ctx.ui.on('map:ready', draw, { signal: scope.signal });
          draw();
        },
      });
    }
  }
  const api = { GeographyLayer, GeographyThemeUI, GeographyDataUI, openGeographyEditor };
  Object.assign((root.AtlasExtensions ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
