# Workspace

The application source is in `work/atlas/`. Read `work/atlas/AGENTS.md` before
changing it. User-facing deliverables belong in `outputs/`; use `work/` for
temporary files and isolated test parties.

The Git repository is rooted in this workspace, not in `work/atlas/`. Keep
application sources, instructions and user-facing outputs versioned. Scratch
files, isolated QA parties and generated archives are ignored; do not force-add
them. The existing source history is preserved on `main`.

The approved UI reference is `outputs/statistics-tree-preview.html`. Its rules
are recorded in the application instructions and now apply to the entire UI:
one monospace family, one 10 px text size, and a 16 px vertical rhythm. Reuse
the application tokens and shared data-view primitives in future extensions.

Region input uses `ui.regionClicks`: many passive observers and at most one
active handler. Bind window listeners through `tab.onRegionClick` so closing
the tab releases them. Do not restore application keyboard shortcuts, the
click-mode selector, or the removed header; the top contains only the menu.

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
