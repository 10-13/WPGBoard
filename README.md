# WPGBoard — АТЛАС для ВПИ

Автономный редактор карты с headless-ядром, библиотекой UI и расширениями.
Каждый релиз — один HTML: его можно скачать, открыть в браузере и передать друзьям.

## Четыре релиза

| Карта | Файл | Содержимое |
| --- | --- | --- |
| Пустая | [atlas-empty.html](outputs/atlas-empty.html) | Исходная карта, без расставленных объектов |
| География | [atlas-geography.html](outputs/atlas-geography.html) | Названия 4587 провинций, 162 региона, рельеф, климат и пояса |
| География и ресурсы | [atlas-geography-resources.html](outputs/atlas-geography-resources.html) | География, базовый выпуск, предприятия и промышленные центры по всему миру |
| TerraMirabilis | [atlas-terra-mirabilis.html](outputs/atlas-terra-mirabilis.html) | Названия, регионы и география; точный каталог 8 ресурсов и 69 исходных ресурсных точек |

TerraMirabilis основана на [TerraMirabilisPublic](https://github.com/NikolasKowalski/TerraMirabilisPublic).
Это отдельная расстановка: собственная мировая экономика в неё не добавляется.
Сохранить игру в JSON вместе с историей и метаданными можно через меню «Файл».

## Онлайн через GitHub Pages

Страница выбора карт: [10-13.github.io/WPGBoard](https://10-13.github.io/WPGBoard/).
На ней можно открыть каждый релиз или скачать его HTML и исходный JSON.
Изменения игры сохраняются локально в браузере пользователя.

Workflow `.github/workflows/pages.yml` проверяет приложение, собирает четыре
карты из исходных JSON и публикует их при изменениях в `main`.
Разовая настройка репозитория: Settings → Pages → Source → GitHub Actions.
Ручной повторный запуск доступен в Actions → Publish map releases → Run workflow.
Сборка сайта локально: `python3 work/atlas/tools/build-pages.py`;
временный сайт находится в `.local/pages/site/`, а `outputs/` содержит только
четыре автономных карты.

## Разработка

- `work/atlas/` — исходники, тесты, оригинал карты и документация API.
- `work/atlas/releases.json` — единственный список поддерживаемых релизов.
- `work/atlas/releases/*.json` — четыре исходных партии с метаданными и историей, под Git.
- `outputs/` — только четыре готовых HTML; они находятся под контролем версий.
- `.local/` — игнорируемые отчёты, снимки, прототипы, пробные сборки и архивы.
- `AGENTS.md` и `work/atlas/AGENTS.md` — правила дальнейшей работы.

Из корня репозитория:

```sh
python3 work/atlas/build.py
node --test work/atlas/tests/*.test.cjs
python3 -B work/atlas/tests/releases_test.py
```

Сборка создаёт четыре HTML из версионируемых JSON, даже если удалить `outputs/`.
При обновлении кода данные партий и ключи автосохранения сохраняются.
Временный шаблон находится в `.local/build/index.html`.
Для локального просмотра: `python3 -m http.server 8766 --bind 127.0.0.1 --directory outputs`.
Подробнее о подготовке новых данных и источниках — в [документации](work/atlas/README.md).

Репозиторий: [10-13/WPGBoard](https://github.com/10-13/WPGBoard), ветка `main`.
История исходников сохранена; прежние превью и лишние варианты убраны из
текущего дерева файлов, локальные копии находятся в `.local/archive/`.
