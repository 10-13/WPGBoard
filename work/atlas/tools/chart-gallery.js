/* Local review gallery; deliberately not part of release bundles. */
(function (root) {
  'use strict';
  function openChartGallery({ manager, desktop, views, sample, selected, initialKind = 'bar' }) {
    const {
      el,
      field,
      button,
      createSelect,
      createSwitch,
      createDataGroup,
      createDataRow,
      ColorScale,
    } = AtlasUI.components;
    const { createTable } = AtlasUI.tables,
      charts = AtlasUI.charts;
    const types = [
      ['bar', '1. Столбчатая'],
      ['line', '2. Линейная'],
      ['pie', '3. Круговая'],
      ['histogram', '4. Гистограмма'],
      ['scatter', '5. Точечная'],
      ['interval', '6. Интервальная'],
      ['heatmap', '7. Тепловая матрица'],
      ['treemap', '8. Nested TreeMap'],
      ['icicle', '9. Icicle'],
      ['sunburst', '10. Sunburst'],
      ['pack', '11. Circle Packing'],
      ['tree', '12. Дерево'],
      ['cluster', '13. Дендрограмма'],
    ];
    const colors = ['#76b6ce', '#d5b16f', '#a3bb83', '#b697c0', '#d18c7c'];
    for (const win of manager.windows) manager.closeWindow(win.id);
    desktop.style.height = desktop.parentElement.clientHeight + 'px';
    return manager.open({
      id: 'chart-gallery',
      title: 'Диаграммы и иерархии / 13 видов',
      x: 16,
      y: 16,
      width: Math.min(960, desktop.clientWidth - 32),
      height: Math.max(320, desktop.parentElement.clientHeight - 32),
      render(pane, scope) {
        pane.classList.add('chart-gallery-pane');
        const navigation = el('div', 'chart-gallery-navigation'),
          buttons = new Map();
        const tree = el('div', 'chart-gallery-tree atlas-data-tree'),
          entries = new Map();
        const info = createDataRow('Область', ''),
          note = el(
            'div',
            'muted',
            'Условные данные · Выберите тип диаграммы и вариант. Исходные данные доступны под каждой диаграммой.',
          );
        let active = types.some(([kind]) => kind === initialKind) ? initialKind : 'bar';
        function choose(kind) {
          active = kind;
          for (const [id, entry] of entries)
            entry.group.element.hidden = kind !== 'all' && id !== kind;
          for (const [id, control] of buttons)
            control.setAttribute('aria-pressed', String(id === kind));
        }
        for (const [kind, title] of [...types, ['all', 'Все в дереве']]) {
          const control = button(title, () => choose(kind));
          control.setAttribute('aria-pressed', 'false');
          buttons.set(kind, control);
          navigation.append(control);
        }
        pane.append(navigation, info, note, tree);
        const numberColumn = (key, label) => ({ key, label, type: 'number' });
        function inputData() {
          const base = sample(),
            empty = !base.pie.length,
            climate = base.lines[0]?.id === 'north';
          const names = base.bars.slice(0, 5).map((item) => item.label);
          const barSeries = empty
            ? []
            : (climate ? ['Осадки', 'Снег', 'Испарение'] : ['Уголь', 'Сталь', 'Нефть']).map(
                (label, i) => ({
                  id: 'series-' + i,
                  label,
                  color: colors[i],
                  values: (climate
                    ? [
                        [42, 35, 41, 48, 62],
                        [22, 18, 14, 6, 1],
                        [8, 10, 18, 29, 36],
                      ]
                    : [
                        [42, 30, 19, 24, 16],
                        [28, 22, 21, 6, 9],
                        [14, 10, 8, 2, 0],
                      ])[i],
                }),
              );
          const values = empty
            ? []
            : Array.from({ length: 72 }, (_, i) =>
                climate
                  ? Math.round(-10 + (i % 13) * 2 + Math.sin(i * 2) * 6)
                  : Math.round(25 + (i % 13) * 4 + Math.sin(i * 2) * 12),
              );
          const scatter = empty
            ? []
            : Array.from({ length: 12 }, (_, i) => ({
                id: 'point-' + i,
                label: names[i % names.length] + (i >= names.length ? ' / объект ' + (i + 1) : ''),
                x: climate ? 5 + ((i * 7) % 27) : 18 + ((i * 13) % 80),
                y: climate ? 20 + ((i * 11) % 70) : 10 + ((i * 19) % 85),
                size: [8, 24, 60, 15, 100, 35, 75, 18, 42, 4, 90, 55][i],
                color: colors[i % colors.length],
              }));
          const intervals = empty
            ? []
            : names.map((label, i) => ({
                id: 'range-' + i,
                label,
                min: climate ? -18 + i * 3 : 20 + i * 6,
                max: climate ? 14 + i * 4 : 55 + i * 8,
                ...(i === 3 ? {} : { center: climate ? 2 + i * 3 : 38 + i * 6 }),
                color: colors[i],
              }));
          const matrix = {
            rows: empty ? [] : base.pie.slice(0, 4).map((item) => item.label),
            columns: empty ? [] : base.labels.slice(0, 6),
            values: empty
              ? []
              : Array.from({ length: 4 }, (_, i) =>
                  Array.from({ length: 6 }, (_, j) =>
                    i === 2 && j === 3 ? null : climate ? -15 + i * 7 + j * 4 : 12 + i * 18 + j * 7,
                  ),
                ),
          };
          const leaf = (id, label, value, colorValue) => ({ id, label, value, colorValue });
          const treeData = {
            id: 'world',
            label: 'Выбранный мир',
            children: empty
              ? []
              : [
                  {
                    id: 'europe',
                    label: 'Европа',
                    color: colors[0],
                    children: [
                      {
                        id: 'west',
                        label: 'Западная Европа',
                        children: [
                          leaf('ruhr', names[0], 42, 92),
                          leaf('lancashire', 'Ланкашир', 24, 68),
                          leaf('lorraine', 'Лотарингия', 18, 81),
                        ],
                      },
                      {
                        id: 'east',
                        label: 'Восточная Европа',
                        children: [
                          leaf('silesia', 'Силезия', 20, 74),
                          leaf('donbass', 'Донбасс', 16, 88),
                          leaf('small', 'Небольшое предприятие', 0.3, 35),
                        ],
                      },
                    ],
                  },
                  {
                    id: 'asia',
                    label: 'Азия',
                    color: colors[1],
                    children: [
                      leaf('japan', 'Япония', 35, 90),
                      leaf('china', 'Северный Китай', 21, 46),
                      leaf('india', 'Индия', 14, 62),
                    ],
                  },
                  {
                    id: 'america',
                    label: 'Америка',
                    color: colors[2],
                    children: [
                      leaf('usa', 'Великие озёра', 48, 96),
                      leaf('canada', 'Канада', 17, 72),
                      leaf('brazil', 'Бразилия', 8, 51),
                    ],
                  },
                  {
                    id: 'other',
                    label: 'Другие районы',
                    color: colors[3],
                    children: [
                      leaf('africa', 'Южная Африка', 12, 64),
                      leaf('australia', 'Австралия', 10, 79),
                      leaf('islands', 'Островные производства', 0.7, 28),
                    ],
                  },
                ],
          };
          // This sample's metric is load: parent values are volume-weighted means.
          // Aggregation stays in the caller; chart components accept explicit colorValue.
          const summarize = (item) => {
            if (item.children?.length) {
              item.children.forEach(summarize);
              item.value = item.children.reduce((sum, child) => sum + child.value, 0);
              if (item.value)
                item.colorValue = item.children.reduce(
                  (sum, child) => sum + child.colorValue * (child.value / item.value),
                  0,
                );
            }
          };
          summarize(treeData);
          return { base, climate, names, barSeries, values, scatter, intervals, matrix, treeData };
        }
        function add(kind, title, description, factory, initial, makeData, addControls) {
          const group = createDataGroup(title, { id: 'gallery-' + kind, open: true });
          const controls = el('div', 'chart-gallery-controls'),
            settings = { ...initial };
          let current;
          const initialData = makeData(inputData(), settings);
          const chart = factory(initialData.data, {
            ...settings,
            ...initialData.options,
            label: title,
            signal: scope.signal,
            onSelect: selected,
          });
          const source = createDataGroup('Исходные данные', {
            id: 'gallery-data-' + kind,
            open: false,
          });
          const table = createTable(initialData.columns, initialData.rows, {
            label: 'Данные: ' + title,
            signal: scope.signal,
          });
          source.body.append(table);
          const refresh = () => {
            current = makeData(inputData(), settings);
            chart.update(current.data, { ...settings, ...current.options });
            table.update(current.rows, { columns: current.columns });
          };
          const set = (patch) => {
            Object.assign(settings, patch);
            refresh();
          };
          const select = (label, key, options) =>
            controls.append(
              field(
                label,
                createSelect(options, (value) => set({ [key]: value }), {
                  value: String(settings[key]),
                  label: title + ': ' + label,
                  signal: scope.signal,
                }),
              ),
            );
          const toggle = (label, key) =>
            controls.append(
              createSwitch(label, (checked) => set({ [key]: checked }), {
                checked: settings[key],
                signal: scope.signal,
              }),
            );
          addControls?.({ select, toggle, set, controls, settings });
          group.body.append(
            el('div', 'chart-gallery-description muted', description),
            controls,
            chart,
            source.element,
          );
          tree.append(group.element);
          entries.set(kind, { group, refresh });
        }
        add(
          'bar',
          'Столбчатая',
          'Сравнение категорий и состав каждой категории. Легенда позволяет скрывать ряды.',
          charts.createBarChart,
          { height: 240, mode: 'grouped', orientation: 'vertical' },
          (data, settings) => ({
            data: data.barSeries,
            options: { labels: data.names, unit: data.climate ? 'мм' : 'ед./ход' },
            columns: [
              { key: 'name', label: 'Категория', width: 2 },
              ...data.barSeries.map((item, i) => numberColumn('s' + i, item.label)),
            ],
            rows: data.names.map((name, i) =>
              Object.fromEntries([
                ['name', name],
                ...data.barSeries.map((item, j) => ['s' + j, item.values[i]]),
              ]),
            ),
          }),
          ({ select }) => {
            select('Направление', 'orientation', [
              ['vertical', 'Вертикальная'],
              ['horizontal', 'Горизонтальная'],
            ]);
            select('Вариант', 'mode', [
              ['ordinary', 'Обычная / первый ряд'],
              ['grouped', 'Сгруппированная'],
              ['stacked', 'С накоплением'],
              ['percent', 'Доли до 100%'],
            ]);
          },
        );
        add(
          'line',
          'Линейная',
          'Пропуски в данных остаются разрывами, в том числе у заливки. Ступень меняется в момент следующей точки.',
          charts.createLineChart,
          { height: 240, step: false, fill: false, points: true, grid: true },
          (data) => ({
            data: data.base.lines,
            options: { labels: data.base.labels, unit: data.base.unit },
            columns: [
              { key: 'name', label: 'Период', width: 2 },
              ...data.base.lines.map((item, i) => numberColumn('s' + i, item.label)),
            ],
            rows: data.base.labels.map((name, i) =>
              Object.fromEntries([
                ['name', name],
                ...data.base.lines.map((item, j) => ['s' + j, item.values[i]]),
              ]),
            ),
          }),
          ({ toggle }) => {
            toggle('Ступенчатая', 'step');
            toggle('Заливка', 'fill');
            toggle('Точки', 'points');
            toggle('Сетка', 'grid');
          },
        );
        add(
          'pie',
          'Круговая',
          'Состав выбранного набора. Нажмите ряд в легенде, чтобы скрыть его; доли пересчитаются.',
          charts.createPieChart,
          { donut: false },
          (data) => ({
            data: data.base.pie,
            options: { unit: data.base.pieUnit },
            columns: [
              { key: 'label', label: 'Категория', width: 2 },
              numberColumn('value', 'Количество'),
            ],
            rows: data.base.pie,
          }),
          ({ toggle }) => toggle('Кольцо', 'donut'),
        );
        add(
          'histogram',
          'Гистограмма',
          'Распределение 72 наблюдений. Интервалы [от; до), последний включает правую границу.',
          charts.createHistogram,
          { height: 240, bins: '8' },
          (data, settings) => {
            const bins = AtlasUI.chartModel.histogram(data.values, Number(settings.bins));
            return {
              data: data.values,
              options: { bins: Number(settings.bins), unit: 'наблюдений' },
              columns: [
                numberColumn('min', 'От'),
                numberColumn('max', 'До'),
                numberColumn('count', 'Частота'),
              ],
              rows: bins,
            };
          },
          ({ select }) =>
            select('Интервалы', 'bins', [
              ['4', '4'],
              ['8', '8'],
              ['12', '12'],
              ['18', '18'],
            ]),
        );
        add(
          'scatter',
          'Точечная',
          'Зависимость двух показателей. В пузырьковом режиме площадь точки пропорциональна третьему показателю.',
          charts.createScatterChart,
          { height: 256, bubble: false },
          (data) => ({
            data: data.scatter,
            options: {
              xLabel: data.climate ? 'Температура, °C' : 'Мощность',
              yLabel: data.climate ? 'Осадки, мм' : 'Выпуск',
              sizeLabel: 'Работники',
            },
            columns: [
              { key: 'label', label: 'Объект', width: 2 },
              numberColumn('x', 'X'),
              numberColumn('y', 'Y'),
              numberColumn('size', 'Площадь'),
            ],
            rows: data.scatter,
          }),
          ({ toggle }) => toggle('Пузырьки', 'bubble'),
        );
        add(
          'interval',
          'Интервальная',
          'Общий масштаб для всех строк: минимум и максимум с краевыми штрихами, центр — светлая отметка. У одной строки центра нет.',
          charts.createIntervalChart,
          { center: true },
          (data) => ({
            data: data.intervals,
            options: { unit: data.base.unit },
            columns: [
              { key: 'label', label: 'Область', width: 2 },
              numberColumn('min', 'Минимум'),
              numberColumn('center', 'Центр'),
              numberColumn('max', 'Максимум'),
            ],
            rows: data.intervals,
          }),
          ({ toggle }) => toggle('Центральное значение', 'center'),
        );
        add(
          'heatmap',
          'Тепловая матрица',
          'Значения ячеек и легенда используют один экземпляр общей ColorScale. Штриховка означает отсутствие данных.',
          charts.createHeatmap,
          { values: true, scaleMode: 'linear' },
          (data, settings) => {
            const values = data.matrix.values.flat().filter((v) => v !== null),
              min = Math.min(...values),
              max = Math.max(...values);
            const scale = new ColorScale(
              values.length
                ? [
                    { value: min, color: '#345c86' },
                    { value: (min + max) / 2, color: '#b6c5a3' },
                    { value: max, color: '#c66f55' },
                  ]
                : [],
              { mode: settings.scaleMode },
            );
            return {
              data: data.matrix,
              options: { scale, unit: data.climate ? '°C' : 'ед./ход' },
              columns: [
                { key: 'name', label: 'Категория', width: 2 },
                ...data.matrix.columns.map((label, i) => numberColumn('c' + i, label)),
              ],
              rows: data.matrix.rows.map((name, i) =>
                Object.fromEntries([
                  ['name', name],
                  ...data.matrix.values[i].map((v, j) => ['c' + j, v]),
                ]),
              ),
            };
          },
          ({ select, toggle }) => {
            select('Переходы', 'scaleMode', [
              ['linear', 'Линейные'],
              ['threshold', 'Пороги'],
              ['spline', 'Кубический сплайн'],
            ]);
            toggle('Значения в ячейках', 'values');
          },
        );
        const hierarchyData = (data, settings) => {
          const rows = [],
            visit = (item, prefix = '') => {
              rows.push({
                name: prefix + item.label,
                type: item.children?.length ? 'Раздел' : 'Объект',
                value: item.value || 0,
                load: item.colorValue,
              });
              item.children?.forEach((child) => visit(child, prefix + item.label + ' / '));
            };
          visit(data.treeData);
          return {
            data: data.treeData,
            options: {
              scale: settings.colorMetric
                ? new ColorScale([
                    { value: 0, color: '#785781' },
                    { value: 50, color: '#d5b16f' },
                    { value: 100, color: '#538f82' },
                  ])
                : null,
              colorLabel: 'Загрузка',
              colorUnit: '%',
            },
            columns: [
              { key: 'name', label: 'Ветка / объект', width: 3 },
              { key: 'type', label: 'Тип' },
              numberColumn('value', 'Объём'),
              numberColumn('load', 'Загрузка, %'),
            ],
            rows,
          };
        };
        const hierarchyExamples = [
          [
            'treemap',
            'Nested TreeMap',
            charts.createTreeMap,
            'Вложенные прямоугольники: площадь показывает объём. Это единственный оставленный вариант TreeMap. Нажатие делает сектор корнем.',
          ],
          [
            'icicle',
            'Icicle',
            charts.createIcicleChart,
            'Близок к Sunburst: одинаковое разбиение дерева, здесь — прямоугольниками по уровням. Длина блока показывает объём; направление можно переключить.',
          ],
          [
            'sunburst',
            'Sunburst',
            charts.createSunburstChart,
            'Круговой аналог Icicle: кольца — уровни дерева, угловая доля — объём. Текст остаётся горизонтальным. Нажатие на центр возвращает к родителю.',
          ],
          [
            'pack',
            'Circle Packing',
            charts.createCirclePack,
            'Вложенные круги показывают структуру. Площадь конечных кругов пропорциональна объёму; родительские круги включают зазоры между детьми.',
          ],
          [
            'tree',
            'Дерево',
            charts.createTreeChart,
            'Близко к дендрограмме: глубина узла задаёт его удаление от корня. Горизонтальный, вертикальный и радиальный виды — переключаемые варианты одной диаграммы.',
          ],
          [
            'cluster',
            'Дендрограмма',
            charts.createClusterChart,
            'Близка к дереву: все листья выравниваются по одному краю или внешней окружности, даже при разной глубине. Радиальный вид выбирается переключателем.',
          ],
        ];
        for (const [kind, title, factory, description] of hierarchyExamples)
          add(
            kind,
            title,
            description,
            factory,
            {
              height: 352,
              colorMetric: false,
              labels: true,
              nodeList: false,
              orientation: kind === 'icicle' ? 'vertical' : 'horizontal',
            },
            hierarchyData,
            ({ select, toggle }) => {
              if (kind === 'icicle')
                select('Направление', 'orientation', [
                  ['vertical', 'Уровни сверху вниз'],
                  ['horizontal', 'Уровни слева направо'],
                ]);
              if (kind === 'tree' || kind === 'cluster')
                select('Вид', 'orientation', [
                  ['horizontal', 'Слева направо'],
                  ['vertical', 'Сверху вниз'],
                  ['radial', 'Радиальный'],
                ]);
              toggle('Цвет: загрузка, %', 'colorMetric');
              toggle('Подписи', 'labels');
              toggle('Список узлов', 'nodeList');
            },
          );
        const refresh = () => {
          info.querySelector('.data-value').textContent = sample().context;
          for (const entry of entries.values()) entry.refresh();
          choose(active);
        };
        views.set('gallery', refresh);
        scope.defer(() => views.delete('gallery'));
        refresh();
      },
    });
  }
  Object.assign((root.AtlasUI ||= {}), { openChartGallery });
})(globalThis);
