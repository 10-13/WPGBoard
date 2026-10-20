/* Game geography vocabulary. Zonal classes are editable approximations, not surveys. */
(function (root) {
  'use strict';
  const entries = (rows) =>
    Object.fromEntries(
      rows.map(([id, label, color, reference]) => [id, { label, color, reference }]),
    );
  const GEOGRAPHY_TYPES = {
    terrain: entries([
      ['lowland', 'Низменность', '#89bd74'],
      ['plain', 'Равнина', '#b9c97e'],
      ['hills', 'Холмистая местность', '#b49d64'],
      ['plateau', 'Плоскогорье', '#bb8459'],
      ['mountains', 'Горы', '#936a60'],
      ['highlands', 'Высокогорье', '#c7b5b2'],
      ['ice', 'Ледниковая местность', '#d5ecf1'],
    ]),
    belt: entries([
      ['equatorial', 'Экваториальный', '#1b9562', 'Обычно +24…+28 °C; 1500–3500 мм/год'],
      [
        'subequatorial',
        'Субэкваториальный',
        '#6cac4c',
        'Обычно +20…+28 °C; 700–2000 мм/год, влажный и сухой сезоны',
      ],
      ['tropical', 'Тропический', '#e5bd56', 'Обычно +18…+30 °C; от пустынь до влажных побережий'],
      ['subtropical', 'Субтропический', '#d79965', 'Обычно +10…+22 °C; 250–1800 мм/год'],
      ['temperate', 'Умеренный', '#7faa8d', 'Обычно −5…+15 °C; 250–1500 мм/год'],
      ['subpolar', 'Субполярный', '#7ca6c8', 'Обычно −15…+5 °C; 150–700 мм/год'],
      ['polar', 'Полярный', '#d0e5ed', 'Обычно ниже 0 °C; 50–500 мм/год'],
      [
        'highland',
        'Высотный климат',
        '#9f8da7',
        'Зависит от высоты и экспозиции; отдельно от широтных поясов',
      ],
    ]),
    soil: entries([
      ['ferralitic', 'Красно-жёлтые ферраллитные', '#bb5147'],
      ['red', 'Красные и красно-бурые', '#c7794f'],
      ['brown', 'Коричневые субтропические', '#a38557'],
      ['forest', 'Бурые лесные', '#826447'],
      ['podzol', 'Подзолистые', '#a4ac91'],
      ['chernozem', 'Чернозёмные', '#514d40'],
      ['chestnut', 'Каштановые', '#a08a61'],
      ['desert', 'Пустынные и серозёмы', '#d6bc82'],
      ['tundra', 'Тундрово-глеевые и мерзлотные', '#a4a3a1'],
      ['mountain', 'Горные почвы', '#857d8d'],
      ['ice', 'Лёд и слаборазвитые почвы', '#dceaf0'],
    ]),
    geographic: entries([
      ['equatorial', 'Экваториальный', '#23895c'],
      ['subequatorial', 'Субэкваториальный', '#83b358'],
      ['tropical', 'Тропический', '#e3b358'],
      ['subtropical', 'Субтропический', '#cb8e65'],
      ['temperate', 'Умеренный', '#7dba9e'],
      ['subpolar', 'Субполярный', '#79a1c3'],
      ['polar', 'Полярный', '#d3e9f1'],
    ]),
    zone: entries([
      ['rainforest', 'Влажные экваториальные леса', '#19714a'],
      ['seasonal', 'Переменно-влажные леса', '#438f48'],
      ['savanna', 'Саванны и редколесья', '#b4b756'],
      ['desert', 'Пустыни и полупустыни', '#e0bd77'],
      ['mediterranean', 'Жестколистные леса и кустарники', '#b29b53'],
      ['steppe', 'Степи и лесостепи', '#bdab63'],
      ['deciduous', 'Широколиственные леса', '#75a264'],
      ['mixed', 'Смешанные леса', '#5c996f'],
      ['taiga', 'Тайга', '#467d72'],
      ['tundra', 'Тундра и лесотундра', '#9da99d'],
      ['ice', 'Арктические пустыни и ледники', '#d5e8ee'],
      ['mountain', 'Высотная поясность', '#9d8b9d'],
    ]),
  };
  const GEOGRAPHY_MONTHS = [
    'Январь',
    'Февраль',
    'Март',
    'Апрель',
    'Май',
    'Июнь',
    'Июль',
    'Август',
    'Сентябрь',
    'Октябрь',
    'Ноябрь',
    'Декабрь',
  ];
  const GEOGRAPHY_KEYS = {
    'geo.lat': [-90, 90],
    'geo.lon': [-180, 180],
    'terrain.elevation': [-500, 9000],
    'terrain.relief': [0, 10000],
    'terrain.type': 'terrain',
    'climate.temperature.monthly': [-100, 70, 12],
    'climate.pressure.monthly': [800, 1100, 12],
    'climate.precipitation.monthly': [0, 5000, 12],
    'climate.belt': 'belt',
    'climate.soil': 'soil',
    'climate.geographicBelt': 'geographic',
    'climate.naturalZone': 'zone',
    'time.offsetMinutes': [-840, 840],
    'time.zoneName': 'text',
  };
  const GEOGRAPHY_THEMES = {
    elevation: {
      title: 'Высоты',
      key: 'terrain.elevation',
      unit: 'м',
      palette: ['#286a50', '#b5c471', '#cfb97b', '#96725c', '#eee4dc'],
    },
    terrain: { title: 'Типы местности', key: 'terrain.type', category: 'terrain' },
    relief: {
      title: 'Перепады высот',
      key: 'terrain.relief',
      unit: 'м',
      hatching: true,
      palette: ['#7c8a8e', '#35434b'],
    },
    temperature: {
      title: 'Температура',
      key: 'climate.temperature.monthly',
      unit: '°C',
      monthly: true,
      palette: ['#304bb0', '#72b9d3', '#e2dc9a', '#e59258', '#b52f40'],
    },
    pressure: {
      title: 'Давление',
      key: 'climate.pressure.monthly',
      unit: 'гПа',
      monthly: true,
      palette: ['#4857a5', '#83b8cc', '#e3ddba', '#d29a68', '#b74b55'],
    },
    belts: { title: 'Климатические пояса', key: 'climate.belt', category: 'belt' },
    precipitation: {
      title: 'Осадки',
      key: 'climate.precipitation.monthly',
      unit: 'мм/год',
      palette: ['#dfc586', '#b3cd9b', '#64b1b0', '#4587bc', '#424ba5'],
    },
    soil: { title: 'Почвенная карта', key: 'climate.soil', category: 'soil' },
    geographic: {
      title: 'Географические пояса',
      key: 'climate.geographicBelt',
      category: 'geographic',
    },
    zones: { title: 'Природные зоны', key: 'climate.naturalZone', category: 'zone' },
    timezones: { title: 'Временные пояса', key: 'time.offsetMinutes', unit: 'мин', timezone: true },
    daylight: { title: 'День и ночь', daylight: true },
  };
  const api = { GEOGRAPHY_TYPES, GEOGRAPHY_MONTHS, GEOGRAPHY_KEYS, GEOGRAPHY_THEMES };
  Object.assign((root.AtlasExtensions ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
