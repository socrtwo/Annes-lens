# Quick Access Bar plan

> **Plan.** This document fixes what the Quick Access Bar (QAT) will offer. It follows the implementation already shipped in the sister apps (`QAT_STANDARD`, `QAT_EXTRAS`, `addAllQatChoices` in the shared shell).

## Principles

- Every command is eligible. The QAT stores command ids; any of the commands in [COMMANDS-PLAN.md](COMMANDS-PLAN.md), plus macros, batch recipes and separators, can be placed on it.
- Picture viewers have toolbars rather than a Quick Access Toolbar, so Anne's Lens's drop-down checklist is the **suite's standard choices** (so that QAT layouts exported from Anne's Pen, Grid, Stage or Folio carry over) plus the **toolbar buttons the surveyed viewers show by default**. Nothing on those default toolbars is left out.
- The bar can sit at the top, below the ribbon, or **at the bottom near the on-screen keyboard or thumb**, and can show or hide labels. In classic menu mode, the bar is the toolbar under the menu bar, as in IrfanView.

## Default toolbar buttons of the surveyed viewers

Compiled from product knowledge and documentation; to be checked against installed copies (tracked in [ROADMAP.md](ROADMAP.md), M0). Because Anne's Lens offers the union, an error in one cell changes nothing but a footnote.

| Button | IrfanView | XnView MP | FastStone | Photo Viewer / Photos | Preview | Anne's Lens command |
|---|---|---|---|---|---|---|
| Open | Yes | Yes | Yes | — | — | `file.open` |
| Save As | Yes | Yes | Yes | Save a copy | — | `file.saveAs` |
| Print | Yes | Yes | Yes | Yes | — | `file.print` |
| Previous / Next | Yes | Yes | Yes | Yes | Yes | `view.previous`, `view.next` |
| Zoom in / out | Yes | Yes | Yes | Yes | Yes | `view.zoomIn`, `view.zoomOut` |
| Original size / Fit | — | Yes | Yes | Yes | Yes | `view.actualSize`, `view.fitWindow` |
| Rotate left / right | Yes | Yes | Yes | Yes | Yes | `image.rotateLeft`, `image.rotateRight` |
| Full screen | — | Yes | Yes | — | Yes | `view.fullScreen` |
| Slideshow | Yes | Yes | Yes | Yes | Yes | `show.start` |
| Thumbnails | Yes | — | — | — | — | `browse.thumbnails` |
| Copy / Paste | Yes | — | — | — | — | `edit.copy`, `edit.paste` |
| Delete | Yes | Yes | Yes | Yes | — | `file.delete` |
| Undo | Yes | Yes | Yes | — | — | `edit.undo` |
| Crop | — | Yes | Yes | Yes | Yes | `edit.crop` |
| Markup | — | — | Yes | Yes | Yes | `edit.markup` |
| Edit / Adjust | — | Yes | Yes | Yes | Yes | `adjust.colorCorrections` |
| Information | — | Yes | Yes | — | Yes | `image.info` |
| Favorite | — | — | — | Yes | — | `browse.favorite` |
| Share / Email | — | Yes | Yes | Yes | Yes | `file.share` |
| Options | Yes | Yes | Yes | — | — | `file.options` |

## Anne's Lens's drop-down

1. **Suite standard choices:** AutoSave is not applicable (pictures save explicitly) and is left out; New is mapped to *Paste as New Picture*; the rest keep their ids: Open, Save, Email, Quick Print, Print Preview and Print, Undo, Redo, Touch/Mouse Mode, Open Recent File.
2. **Viewer extras** (the union above): Save As, Previous, Next, Zoom In, Zoom Out, Original Size, Fit to Window, Rotate Left, Rotate Right, Full Screen, Start Slideshow, Thumbnails, Copy, Paste, Delete, Crop Selection, Markup Board, Color Corrections, Picture Information, Favorite, Share, Options, Batch Conversion and Rename, Search Commands.
3. **Add All Choices (Save, Print first, then A–Z)** (`view.qatAddAll`): puts every choice from lists 1 and 2 on the bar, **Save** and **Print** first, then the rest sorted alphabetically by label (case-insensitive), then anything else already on the bar in its existing order. Separators are kept.
4. **More Commands…** (`file.customizeQat`).
5. **Position** (`view.qatPosition`): above the ribbon, below the ribbon, at the bottom.
6. **Show / Hide Labels** (`view.qatLabels`).
7. **Hide Quick Access Bar** (`view.qatHide`; restore with `view.qatShow` or by long-pressing any command).
8. **Collapse the Ribbon** (`view.collapseRibbon`).

| # | Command | id |
|---|---|---|
| 1 | Save | `file.save` |
| 2 | Print… | `file.print` |
| 3 | Batch Conversion and Rename… | `batch.convert` |
| 4 | Color Corrections… | `adjust.colorCorrections` |
| 5 | Copy | `edit.copy` |
| 6 | Crop Selection | `edit.crop` |
| 7 | Delete | `file.delete` |
| 8 | Email… | `file.email` |
| 9 | Favorite | `browse.favorite` |
| 10 | Fit to Window | `view.fitWindow` |
| 11 | Full Screen | `view.fullScreen` |
| 12 | Markup Board | `edit.markup` |
| 13 | Next Picture | `view.next` |
| 14 | Open… | `file.open` |
| 15 | Options… | `file.options` |
| 16 | Original Size | `view.actualSize` |
| 17 | Paste | `edit.paste` |
| 18 | Paste as New Picture | `edit.pasteAsNew` |
| 19 | Picture Information | `image.info` |
| 20 | Previous Picture | `view.previous` |
| 21 | Print Preview | `file.printPreview` |
| 22 | Quick Print | `file.quickPrint` |
| 23 | Recent Files | `file.openRecent` |
| 24 | Redo | `edit.redo` |
| 25 | Rotate Left | `image.rotateLeft` |
| 26 | Rotate Right | `image.rotateRight` |
| 27 | Save As… | `file.saveAs` |
| 28 | Search Commands | `view.cmdSearch` |
| 29 | Share… | `file.share` |
| 30 | Start Slideshow | `show.start` |
| 31 | Thumbnails | `browse.thumbnails` |
| 32 | Touch/Mouse Mode | `view.touchMode` |
| 33 | Undo | `edit.undo` |
| 34 | Zoom In | `view.zoomIn` |
| 35 | Zoom Out | `view.zoomOut` |

**Default bar** (new installs): Open, Save As, Previous, Next, Rotate Left, Rotate Right, Full Screen, Search Commands — close to IrfanView's own default toolbar.

## Customize Quick Access Bar dialog

As in the sister apps: a *Choose commands from* list with **Popular Commands**, **Commands Not in the Tabs**, **All Commands**, each built-in and custom tab (including the contextual Pages and Frames, RAW and Picture Tools tabs), **Macros** and **Batch Recipes**; buttons Add, Remove, Add Separator, Move Up, Move Down, Add All A–Z, Reset, Import/Export (JSON, shared format with the suite).
