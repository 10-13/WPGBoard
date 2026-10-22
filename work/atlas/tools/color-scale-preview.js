/* Isolated UI preview: uses the production model, controls, menus and windows. */
(function () {
  'use strict';
  const { WindowManager, TreeMenu } = AtlasUI;
  const {
    ColorScale,
    button,
    createColorScale,
    createDataRow,
    createDataGroup,
    createNumberInput,
    el,
    field,
  } = AtlasUI.components;
  const windows = new WindowManager(document.getElementById('workspace'));
  let points = [
    { value: 0, color: '#264caa' },
    { value: 20, color: '#53cbb9' },
    { value: 70, color: '#e8d278' },
    { value: 100, color: '#cb4050' },
  ];
  let sample = 40;
  let mode = 'linear';
  function open() {
    windows.open({
      id: 'color-scales-preview',
      title: 'Цветовые шкалы',
      x: 24,
      y: 16,
      width: Math.min(620, window.innerWidth - 32),
      height: Math.min(752, window.innerHeight - 64),
      render(pane) {
        pane.classList.add('atlas-data-scope');
        const content = el('div', 'scale-preview-content');
        const editor = createDataGroup('Точки · значение → цвет', { open: true });
        const comparison = el('div');
        const error = el('p', 'form-error');
        error.setAttribute('role', 'status');
        const probe = createNumberInput({
          step: 'any',
          value: sample,
          label: 'Значение для проверки цвета',
          onInput: (_, event) => {
            sample = event.currentTarget.valueAsNumber;
            update();
          },
        });
        const raw = createDataGroup('Сырые точки', { open: false });
        const rawText = el('pre', 'scale-preview-json');
        raw.body.append(rawText);
        const update = () => {
          try {
            const model = new ColorScale(points, { mode });
            error.textContent = '';
            comparison.replaceChildren();
            comparison.append(
              createColorScale(model, {
                label: 'Цветовая шкала',
                onModeChange: (value) => {
                  mode = value;
                  update();
                },
              }),
            );
            const color = model.color(sample);
            const row = createDataRow(
              'Цвет для ' + (Number.isFinite(sample) ? sample : '—'),
              color || 'Нет значения',
            );
            if (color) {
              const patch = el('span', 'resource-legend-swatch');
              patch.style.backgroundColor = color;
              row.querySelector('.data-name').prepend(patch);
            }
            comparison.append(row);
            rawText.textContent = JSON.stringify(model.points, null, 2);
          } catch (err) {
            error.textContent = err.message;
          }
        };
        const drawEditor = () => {
          editor.body.replaceChildren();
          for (const [i, point] of points.entries()) {
            const row = el('div', 'scale-preview-point');
            const value = createNumberInput({
              step: 'any',
              value: point.value,
              label: 'Значение точки ' + (i + 1),
              onInput: (_, event) => {
                point.value = event.currentTarget.valueAsNumber;
                update();
              },
            });
            const color = document.createElement('input');
            color.type = 'color';
            color.value = point.color;
            color.setAttribute('aria-label', 'Цвет точки ' + (i + 1));
            const hex = el('span', '', point.color);
            color.oninput = () => {
              point.color = color.value;
              hex.textContent = color.value;
              update();
            };
            const remove = button(
              '×',
              () => {
                points.splice(i, 1);
                drawEditor();
                update();
              },
              { title: 'Удалить точку ' + (i + 1), className: 'icon-button' },
            );
            row.append(value, color, hex, remove);
            editor.body.append(row);
          }
          editor.body.append(
            button('+ Точка', () => {
              const max = Math.max(0, ...points.map((p) => p.value).filter(Number.isFinite));
              points.push({ value: max + 25, color: '#af70ce' });
              drawEditor();
              update();
            }),
          );
        };
        content.append(
          el(
            'p',
            'muted',
            'Измените точки и выберите режим. Шкала и цвет для проверяемого значения пересчитываются вместе.',
          ),
          editor.element,
          error,
          field('Проверить значение', probe),
          comparison,
          raw.element,
          el(
            'p',
            'muted',
            'Порог включает своё значение. За краями — крайний цвет. Сплайн проходит через точки; RGB ограничивается диапазоном 0–255.',
          ),
        );
        drawEditor();
        update();
        pane.append(content);
      },
    });
  }
  const menu = new TreeMenu({ rootOrder: ['Вид'] });
  menu.register({ id: 'scales', path: ['Вид', 'Окна'], label: 'Цветовые шкалы', handler: open });
  menu.mountBar(document.getElementById('menubar'));
  open();
})();
