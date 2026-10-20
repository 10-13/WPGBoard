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
