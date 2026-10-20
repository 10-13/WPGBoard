/* Geography is a tree of independent thematic extensions over shared tile metadata. */
(function (root) {
  'use strict';
  const themeModule = (id, name, themes) => ({
    id,
    name,
    start(ctx) {
      const { model } = ctx.require('geography');
      const layers = Object.fromEntries(
        themes.map((theme) => [
          theme,
          new root.AtlasExtensions.GeographyThemeUI(ctx, model, theme),
        ]),
      );
      ctx.provide({ model, layers });
    },
  });
  const geography = {
    id: 'geography',
    name: 'География',
    description:
      'Рельеф, климат, почвы, природные зоны и местное время. Изменения данных — в истории; отображение — локально.',
    start(ctx) {
      const model = new root.AtlasExtensions.GeographyModel(ctx.state);
      model.registerActions(ctx.signal);
      const data = new root.AtlasExtensions.GeographyDataUI(ctx, model);
      ctx.provide({ model, openData: () => data.open() });
    },
    children: [
      themeModule('relief', 'Рельеф', ['elevation', 'relief', 'terrain']),
      {
        id: 'climate',
        name: 'Климат',
        start() {},
        children: [
          themeModule('temperature', 'Температура', ['temperature']),
          themeModule('pressure', 'Давление', ['pressure']),
          themeModule('belts', 'Климатические пояса', ['belts']),
          themeModule('precipitation', 'Осадки', ['precipitation']),
          themeModule('soil', 'Почвенная карта', ['soil']),
          themeModule('zones', 'Географические пояса и природные зоны', ['geographic', 'zones']),
        ],
      },
      {
        id: 'time',
        name: 'Время',
        start(ctx) {
          const { model } = ctx.require('geography');
          const time = new root.AtlasExtensions.GeographyTimeUI(ctx, model);
          ctx.provide({ model, time });
        },
      },
    ],
  };
  Object.assign((root.AtlasExtensions ||= {}), { geography });
  if (typeof module !== 'undefined' && module.exports) module.exports = { geography };
})(globalThis);
