# Workspace

The application source is in `work/atlas/`. Read `work/atlas/AGENTS.md` before
changing it. `outputs/` contains exactly the four standalone HTML releases from
`work/atlas/releases.json`: empty, geography, geography with the world economy,
and TerraMirabilis (including province names, named regions and geography).
The four authored JSON parties live in `work/atlas/releases/` under Git; a fresh
clone must build the HTML from these without any `.local` files. Ordinary UI
builds preserve their data and autosave keys; conflicting HTML/JSON must be
reconciled explicitly.
All temporary reports, screenshots, previews, trial builds, QA parties, caches
and archives belong in `.local/` directories, ignored at every nesting level.
`work/atlas/` contains maintained sources only. Do not force-add `.local` files.

The Git repository is rooted in this workspace, not in `work/atlas/`. Keep
application sources, instructions and user-facing outputs versioned. Scratch
files, isolated QA parties and generated archives are ignored; do not force-add
them. The existing source history is preserved on `main`.

The approved UI reference was `statistics-tree-preview.html` (retained in Git
history and the local cleanup archive). Its rules are recorded in the
application instructions and apply to the entire UI:
one monospace family, one 10 px text size, and a 16 px vertical rhythm. Reuse
the application tokens and shared data-view primitives in future extensions.

Region input uses `ui.regionClicks`: many passive observers and at most one
active handler. Bind window listeners through `tab.onRegionClick` so closing
the tab releases them. Do not restore application keyboard shortcuts, the
click-mode selector, or the removed header; the top contains only the menu.
Continuous brushes use the same active subscription with optional
`stroke: {start,move,end,cancel}` hooks. Preview until release; one stroke is
one game action. Closing/switching the editor, losing focus or adding a second
touch cancels the preview. Pixel control belongs to `nations:control`, stored
separately from legal province ownership in `meta.territorialControl` as sparse
64 px chunks. Do not alter resources or restore red war borders.

Common province selection belongs to `ui.regionSelection`: click selects one,
Shift-click toggles a province without invoking the active editor. This mouse
modifier is explicitly approved. Province menu entries declare `batch: true`
for array handlers; ordinary entries only appear for a single province. The
statistics set remains separate, edited through batch context-menu commands.
Use `AtlasUI.controls.button` / `createSwitch` for reusable controls.

Named regions are an independent extension (`regions-model.js`, `regions.js`),
stored in `meta.regions`. Obsolete nation groups have no runtime API or UI and
must not be migrated into regions. Keep the context tree rooted at Мир,
Провинция, Прочее; domain extensions register their own subtrees.
The regions module owns the `regions:boundaries` overlay: exterior contours
and names, with no seams between provinces of the same named region.
Province highlights share `AtlasUI.drawRegionSet`; their pixel contour must
check all four neighbors, including above/below, holes and map edges.

Overlay definitions and local display preferences belong to `state.overlays`.
Visibility and composition order are not game actions: never put them in game
metadata, history, branches, or party JSON/HTML. Persist display preferences
separately in browser storage. Modules draw through `ctx.overlay`; hiding an
overlay never deletes its game objects. Version actual map-object changes only.

Blueprints belong to the resources extension. Their inputs/outputs are volumes;
enterprise capacity is separate. The headless catalog and cost expansion live
in `resource-catalog.js`; UI uses shared data views. Catalog edits are actions
in `meta.resources.catalog`. Resource cost means consumed resources, without
money or time. Keep the version 1 base template stable for existing parties.

The top menu order is Файл, Вид, Мир, Инструменты. Window launchers register
through `ctx.windowMenu` in Вид → Окна; domain commands belong to Мир → Нации /
Регионы / Ресурсы. Tools are Выделение, История, Данные → Мета / Статистика.
Keep the province context-menu structure separate. Neighbor selection expands
by one province layer; erosion removes one boundary layer, including coasts.
Use headless `ProvinceTopology` and `viewport.getTopology()`; never bridge water.
