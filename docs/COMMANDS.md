# Anne's Lens Command Reference

Anne's Lens has **125 commands** built, out of the **557** in the plan ([COMMANDS-PLAN.md](COMMANDS-PLAN.md)). Every built command can be placed on the Quick Access Bar, added to a custom tab, found in the classic menus, bound to a keyboard shortcut, recorded in a macro, or found with command search (Alt+Q). A command is registered only when it works; the rest of the plan is listed at the end of this file.

4 of the built commands are "Commands Not in the Tabs" (reachable through the Quick Access Bar chooser, Customize Tabs, the classic menus and command search), so nothing the app can do is hidden.

This file is generated from the source by `npm run catalog`; a unit test fails when it is out of date.

## Ribbon

The ribbon mirrors the plan: one tab per plan tab and one group per plan group, in the plan's order, plus the Home tab. Groups that have no built command yet are not shown.

- **Home**: Clipboard (3) · Navigate (5) · Rotate (4) · Organize (3) · View (3) · Share (4)
- **File**: Open (11) · Save (7) · Files (10) · Print (4) · Share (2) · Close and options (10)
- **Edit**: Undo (2) · Clipboard (3)
- **Image**: Information (4) · Rotate and flip (6) · Lossless JPEG (3)
- **Metadata**: View and edit (1)
- **Pages and Frames** (contextual): Pages (3) · Frames (4)
- **View**: Zoom (12) · Navigate (7) · Window (10) · Inspect (2) · Display (2) · Quick Access Bar and search (5)
- **Developer**: Developer (5)
- **Help**: Help (8)

## Classic menu layouts

| Layout | Modeled on | Built commands on the bar |
|---|---|---|
| IrfanView style (`irfanview`) | IrfanView 4.x main window (File, Edit, Image, Options, View, Help) | 63 |
| IrfanView Thumbnails style (`irfanview-thumbs`) | IrfanView 4.x thumbnail window | 14 |
| XnView style (`xnview`) | XnView MP browser and viewer | 43 |
| FastStone style (`faststone`) | FastStone Image Viewer | 26 |
| ACDSee style (`acdsee`) | ACDSee (Manage, View and Edit modes) | 21 |
| Windows Photo Viewer style (`photoviewer`) | Windows Photo Viewer and Microsoft Photos (toolbar commands as menus) | 21 |
| Picasa style (`picasa`) | Picasa 3 | 17 |
| Preview style (`preview`) | macOS Preview | 31 |
| digiKam style (`digikam`) | digiKam albums and image editor | 10 |
| All viewers combined (`all`) | the union of every layout above, merged menu by menu without duplicates (Picture, Modify and Item merge into Image; Go and Window into View; Album, Tag and Folder into Organize; Import and Export into File; Settings into Options) | 77 |
| Anne's Lens complete (`complete`) | the ribbon itself: one menu per tab, one submenu per group, every command | 125 |

## File (47 of 82)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Clear Recent Lists | Open |  | `file.clearRecent` | not in tabs |
| Open as Hex | Open |  | `file.openHex` | from IrfanView, XnView Classic and XnView MP |
| Open as Text | Open |  | `file.openText` | from IrfanView |
| Open Folder… | Open | Ctrl+Shift+o | `file.openFolder` | from XnView Classic and XnView MP, FastStone Image Viewer, digiKam |
| Open in New Window | Open | Ctrl+n | `file.newWindow` | from nomacs, Preview, IrfanView |
| Open RAW Pixel Data… | Open |  | `file.openRawPixels` | from IrfanView |
| Open With (system) | Open |  | `file.openWith` | from Microsoft Photos, Preview, Android gallery apps |
| Open… | Open | o, Ctrl+o | `file.open` | from IrfanView, most picture viewers |
| Recent Files | Open |  | `file.openRecent` | has options menu; from IrfanView, XnView Classic and XnView MP |
| Recent Folders | Open |  | `file.recentFolders` | has options menu; from XnView Classic and XnView MP, FastStone Image Viewer |
| Recovery Report | Open |  | `file.recoveryReport` | from the Anne's Office suite |
| Show in Folder | Open | Ctrl+Shift+e | `file.revealInFolder` | from IrfanView, XnView Classic and XnView MP, Microsoft Photos |
| Reload | Save | Shift+r | `file.reload` | from IrfanView |
| Save | Save | Ctrl+s | `file.save` | from IrfanView, most picture viewers |
| Save a Copy… | Save |  | `file.saveCopy` |  |
| Save All Changed | Save | Ctrl+Shift+s | `file.saveAll` | from new in Anne's Lens |
| Save As… | Save | s | `file.saveAs` | from IrfanView |
| Save for Web… | Save | Ctrl+Alt+s | `file.saveForWeb` | from IrfanView, XnView Classic and XnView MP |
| Save to Target File Size… | Save |  | `file.saveTargetSize` | from IrfanView, new in Anne's Lens |
| Change File Date/Time… | Files |  | `file.setFileTime` | from FastStone Image Viewer, XnView Classic and XnView MP |
| Copy File Name | Files |  | `file.copyName` | not in tabs; from IrfanView |
| Copy Full Path | Files |  | `file.copyPath` | not in tabs; from XnView Classic and XnView MP |
| Copy To… | Files | F8 | `file.copyTo` | from IrfanView |
| Delete | Files | Delete | `file.delete` | from IrfanView, most picture viewers |
| Delete Permanently | Files | Shift+Delete | `file.deletePermanent` | from IrfanView, XnView Classic and XnView MP |
| File Date from EXIF Date | Files |  | `file.fileTimeFromExif` | from XnView Classic and XnView MP, IrfanView |
| Move To… | Files | F7 | `file.moveTo` | from IrfanView |
| Quick Copy to Folder 1–9 | Files |  | `file.quickCopy` | has options menu; from FastStone Image Viewer, XnView Classic and XnView MP, FastPictureViewer |
| Quick Move to Folder 1–9 | Files |  | `file.quickMove` | has options menu; from FastStone Image Viewer, XnView Classic and XnView MP, FastPictureViewer |
| Rename… | Files | F2 | `file.rename` | from IrfanView, most picture viewers |
| Undo File Operation | Files | Ctrl+Alt+z | `file.undoFileOp` | from new in Anne's Lens |
| Print at True Size… | Print |  | `file.printTrueSize` | from new in Anne's Lens |
| Print Preview | Print |  | `file.printPreview` | from IrfanView, Microsoft Photos |
| Print… | Print | Ctrl+p | `file.print` | from IrfanView, most picture viewers |
| Quick Print | Print |  | `file.quickPrint` |  |
| Email… | Share | Ctrl+Shift+m | `file.email` | from IrfanView, Windows Photo Viewer and Windows Picture and Fax Viewer, Picasa, FastStone Image Viewer |
| Share… | Share |  | `file.share` | from Microsoft Photos, Android gallery apps, Preview |
| Close | Close and options | Ctrl+w | `file.close` |  |
| Close All | Close and options |  | `file.closeAll` |  |
| Customize Keyboard… | Close and options |  | `file.customizeKeyboard` | from the Anne's Office suite, IrfanView |
| Customize Quick Access Bar… | Close and options |  | `file.customizeQat` | from the Anne's Office suite |
| Customize Tabs… | Close and options |  | `file.customizeRibbon` | from the Anne's Office suite |
| Exit | Close and options | Escape, Alt+F4 | `file.exit` | from IrfanView |
| Export / Import Settings… | Close and options |  | `file.exportSettings` | from the Anne's Office suite, IrfanView |
| Options… | Close and options | p | `file.options` | from IrfanView |
| Portable Mode | Close and options |  | `file.portableMode` | from IrfanView, XnView Classic and XnView MP |
| Reset All Customizations | Close and options |  | `file.resetCustomizations` | from the Anne's Office suite |

## Edit (5 of 55)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Redo | Undo | Ctrl+Shift+z | `edit.redo` | from most picture viewers |
| Undo | Undo | Ctrl+z | `edit.undo` | from IrfanView, most picture viewers |
| Copy | Clipboard | Ctrl+c | `edit.copy` | from IrfanView, most picture viewers |
| Paste | Clipboard | Ctrl+v | `edit.paste` | from IrfanView, most picture viewers |
| Paste as New Picture | Clipboard | Ctrl+Shift+v | `edit.pasteAsNew` | from IrfanView, XnView Classic and XnView MP |

## Image (13 of 41)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Count Unique Colors | Information |  | `image.countColors` | from IrfanView |
| Estimate JPEG Quality | Information |  | `image.jpegQuality` | from XnView Classic and XnView MP, new in Anne's Lens |
| Histogram | Information | Shift+h | `image.histogram` | from IrfanView, XnView Classic and XnView MP, FastStone Image Viewer |
| Picture Information | Information | i | `image.info` | from IrfanView, most picture viewers |
| Auto-Rotate by EXIF Orientation | Rotate and flip |  | `image.autoRotateExif` | from IrfanView, XnView Classic and XnView MP |
| Flip Horizontal | Rotate and flip | h | `image.flipH` | from IrfanView |
| Flip Vertical | Rotate and flip | v | `image.flipV` | from IrfanView |
| Rotate 180° | Rotate and flip |  | `image.rotate180` |  |
| Rotate Left | Rotate and flip | l | `image.rotateLeft` | from IrfanView, most picture viewers |
| Rotate Right | Rotate and flip | r | `image.rotateRight` | from IrfanView, most picture viewers |
| Lossless Auto-Rotate by EXIF | Lossless JPEG |  | `image.losslessAutoRotate` | from XnView Classic and XnView MP, FastStone Image Viewer |
| Lossless Crop | Lossless JPEG |  | `image.losslessCrop` | from IrfanView, XnView Classic and XnView MP |
| Lossless JPEG Transformations… | Lossless JPEG | Shift+j | `image.losslessJpeg` | from IrfanView, XnView Classic and XnView MP, FastStone Image Viewer |

## Metadata (1 of 26)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| EXIF Information | View and edit | e | `meta.exif` | from IrfanView, most picture viewers |

## Pages and Frames (7 of 15)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Go to Page… | Pages |  | `pages.goto` | from IrfanView |
| Next Page | Pages | Ctrl+PageDown | `pages.next` | from IrfanView |
| Previous Page | Pages | Ctrl+PageUp | `pages.previous` | from IrfanView |
| Animation Speed | Frames |  | `frames.speed` | has options menu; from new in Anne's Lens |
| Next Frame | Frames | . | `frames.next` | from XnView Classic and XnView MP |
| Play / Pause Animation | Frames | Ctrl+Space | `frames.play` | from IrfanView, XnView Classic and XnView MP |
| Previous Frame | Frames |  | `frames.previous` | from XnView Classic and XnView MP |

## View (39 of 72)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Center Picture | Zoom |  | `view.center` | from IrfanView |
| Fill Window | Zoom |  | `view.fill` | from ImageGlass |
| Fit Height | Zoom |  | `view.fitHeight` | from IrfanView |
| Fit Only Large Pictures | Zoom |  | `view.fitLarge` | from IrfanView |
| Fit to Window | Zoom | Shift+f | `view.fitWindow` | from IrfanView |
| Fit Width | Zoom |  | `view.fitWidth` | from IrfanView |
| Fit Window to Picture | Zoom |  | `view.fitWindowToImage` | from IrfanView |
| Keep Position | Zoom |  | `view.keepPosition` | from XnView Classic and XnView MP, new in Anne's Lens |
| Lock Zoom | Zoom |  | `view.zoomLock` | from IrfanView, XnView Classic and XnView MP |
| Original Size | Zoom | Ctrl+h | `view.actualSize` | from IrfanView |
| Zoom In | Zoom | =, Shift+= | `view.zoomIn` | from IrfanView, most picture viewers |
| Zoom Out | Zoom | + | `view.zoomOut` | from IrfanView, most picture viewers |
| First Picture | Navigate | Home | `view.first` | from IrfanView |
| Go to Picture Number… | Navigate | Ctrl+Shift+j | `view.gotoIndex` | from new in Anne's Lens |
| Last Picture | Navigate | End | `view.last` | from IrfanView |
| Next Picture | Navigate | Space, PageDown, ArrowRight | `view.next` | from IrfanView, most picture viewers |
| Previous Picture | Navigate | Backspace, PageUp, ArrowLeft | `view.previous` | from IrfanView, most picture viewers |
| Random Picture | Navigate |  | `view.random` | from XnView Classic and XnView MP, IrfanView |
| Wrap Around at Ends | Navigate |  | `view.wrap` | from IrfanView, XnView Classic and XnView MP |
| Always on Top | Window |  | `view.alwaysOnTop` | from IrfanView, XnView Classic and XnView MP |
| Classic Menu Layout | Window |  | `view.menuLayout` | has options menu; from new in Anne's Lens |
| Collapse the Ribbon | Window | Ctrl+F1 | `view.collapseRibbon` | from the Anne's Office suite |
| Full Screen | Window | Enter, F11 | `view.fullScreen` | from IrfanView, most picture viewers |
| Menus | Window |  | `view.menuMode` | from the Anne's Office suite |
| Minimize | Window | m | `view.minimize` | from IrfanView |
| Status Bar | Window |  | `view.statusBar` | from IrfanView |
| Theme | Window |  | `view.theme` | has options menu |
| Toolbar | Window |  | `view.toolbar` | from IrfanView |
| Touch/Mouse Mode | Window |  | `view.touchMode` | from the Anne's Office suite |
| Pixel Grid | Inspect |  | `view.pixelGrid` | from new in Anne's Lens |
| Pixel Information | Inspect |  | `view.pixelInfo` | from IrfanView, ImageGlass |
| Background Color… | Display |  | `view.background` | from IrfanView |
| Transparency Display | Display |  | `view.alphaDisplay` | has options menu; from XnView Classic and XnView MP, ImageGlass |
| Add All Choices to Quick Access Bar | Quick Access Bar and search |  | `view.qatAddAll` | from the Anne's Office suite |
| Hide Quick Access Bar | Quick Access Bar and search |  | `view.qatHide` | from the Anne's Office suite |
| Quick Access Bar Labels | Quick Access Bar and search |  | `view.qatLabels` | from the Anne's Office suite |
| Quick Access Bar Position | Quick Access Bar and search |  | `view.qatPosition` | has options menu; from the Anne's Office suite |
| Search Commands | Quick Access Bar and search | Alt+q | `view.cmdSearch` | from the Anne's Office suite |
| Show Quick Access Bar | Quick Access Bar and search |  | `view.qatShow` | not in tabs; from the Anne's Office suite |

## Developer (5 of 7)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Export Command List (JSON) | Developer |  | `dev.exportCommands` | from the Anne's Office suite |
| Macro Editor… | Developer | Alt+F11 | `dev.macroEditor` | from the Anne's Office suite |
| Macros… | Developer | Alt+F8 | `dev.macros` | from the Anne's Office suite |
| Record Macro | Developer |  | `dev.recordMacro` | from the Anne's Office suite |
| Stop Recording | Developer |  | `dev.stopRecording` | from the Anne's Office suite |

## Help (8 of 8)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| About Anne's Lens | Help |  | `help.about` | from IrfanView |
| Check for Updates | Help |  | `help.checkUpdates` | from IrfanView |
| Help | Help | F1 | `help.contents` | from most picture viewers |
| Keyboard Shortcuts | Help | Ctrl+/ | `help.shortcuts` | from IrfanView |
| Menu Map | Help |  | `help.menuMap` | from the Anne's Office suite |
| Report a Problem | Help |  | `help.reportIssue` |  |
| Supported Formats | Help |  | `help.formats` | from IrfanView, XnView Classic and XnView MP |
| What's New | Help |  | `help.whatsNew` |  |

## Planned, not yet built (432)

These ids are in the plan but have no command yet; they belong to later milestones ([ROADMAP.md](ROADMAP.md)). Nothing below is a placeholder in the app.

- **File** (35): `file.openUrl`, `file.openExternal`, `file.openRepair`, `file.recoverAny`, `file.openEncrypted`, `file.saveSelection`, `file.encrypt`, `file.export.pdf`, `file.export.folio`, `file.export.stage`, `file.export.pen`, `file.export.press`, `file.export.animation`, `file.export.icon`, `file.export.palette`, `file.export.metadataCsv`, `file.copyAsFile`, `file.hide`, `file.sysProperties`, `file.scan`, `file.batchScan`, `file.selectSource`, `file.importCamera`, `file.importRules`, `file.capture`, `file.captureCamera`, `file.printLayouts`, `file.copyShop`, `file.printSetup`, `file.wallpaper`, `file.lockScreen`, `file.contactPhoto`, `file.cast`, `file.customizeMenus`, `file.associations`
- **Edit** (50): `edit.history`, `edit.cut`, `edit.cutOutside`, `edit.pasteInto`, `edit.pasteBeside`, `edit.clear`, `edit.fill`, `edit.selectAll`, `edit.selectNone`, `edit.selectInvert`, `edit.customSelection`, `edit.selectMaxAspect`, `edit.selectionInfo`, `edit.selectRect`, `edit.selectEllipse`, `edit.selectLasso`, `edit.selectWand`, `edit.selectColor`, `edit.crop`, `edit.cropAspect`, `edit.cropPrint`, `edit.autoCrop`, `edit.cropPage`, `edit.insertText`, `edit.insertOverlay`, `edit.border`, `edit.canvasSize`, `edit.signature`, `edit.paint`, `edit.markup`, `edit.redact`, `edit.callout`, `paint.brush`, `paint.pencil`, `paint.line`, `paint.arrow`, `paint.rect`, `paint.ellipse`, `paint.text`, `paint.eraser`, `paint.fill`, `paint.spray`, `paint.clone`, `paint.heal`, `paint.redEye`, `paint.colorReplace`, `paint.colorPicker`, `edit.flattenMarkup`, `edit.findFiles`, `edit.gotoFile`
- **Image** (28): `image.showChannel`, `image.rotateCustom`, `image.straighten`, `image.autoStraighten`, `image.perspective`, `image.lensCorrection`, `image.deskew`, `image.resize`, `image.halfSize`, `image.doubleSize`, `image.resizeToScreen`, `image.seamCarve`, `image.setDpi`, `image.grayscale`, `image.negative`, `image.decreaseDepth`, `image.increaseDepth`, `image.threshold`, `image.swapChannels`, `image.paletteEdit`, `image.paletteImport`, `image.replaceColor`, `image.transparentColor`, `image.flatten`, `image.alphaFromMask`, `image.convertProfile`, `image.assignProfile`, `image.softProof`
- **Adjust** (47): `adjust.auto`, `adjust.enhance`, `adjust.autoLevels`, `adjust.autoContrast`, `adjust.autoColor`, `adjust.autoWhiteBalance`, `adjust.colorCorrections`, `adjust.brightnessContrast`, `adjust.exposure`, `adjust.levels`, `adjust.curves`, `adjust.gamma`, `adjust.shadowsHighlights`, `adjust.fillLight`, `adjust.toneEqualizer`, `adjust.equalize`, `adjust.normalize`, `adjust.clarity`, `adjust.dehaze`, `adjust.vignette`, `adjust.whiteBalance`, `adjust.hsl`, `adjust.vibrance`, `adjust.colorBalance`, `adjust.selectiveColor`, `adjust.channelMixer`, `adjust.bwMixer`, `adjust.tint`, `adjust.warmify`, `adjust.posterize`, `adjust.lut`, `adjust.sharpen`, `adjust.unsharp`, `adjust.blur`, `adjust.denoise`, `adjust.despeckle`, `adjust.redEye`, `adjust.dustScratches`, `adjust.restoreFaded`, `adjust.descreen`, `adjust.beforeAfter`, `adjust.copySettings`, `adjust.pasteSettings`, `adjust.savePreset`, `adjust.applyPreset`, `adjust.resetAll`, `adjust.revertOriginal`
- **Effects** (47): `fx.browser`, `fx.repeatLast`, `fx.convolution`, `fx.plugins8bf`, `fx.emboss`, `fx.oilPaint`, `fx.edgeDetect`, `fx.median`, `fx.pencilSketch`, `fx.watercolor`, `fx.cartoon`, `fx.halftone`, `fx.mosaic`, `fx.pixelize`, `fx.solarize`, `fx.tiles`, `fx.button3d`, `fx.filmGrain`, `fx.softFocus`, `fx.glow`, `fx.focalBW`, `fx.graduatedTint`, `fx.orton`, `fx.crossProcess`, `fx.toyCamera`, `fx.tiltShift`, `fx.duotone`, `fx.noise`, `fx.swirl`, `fx.explosion`, `fx.rain`, `fx.fragment`, `fx.spread`, `fx.shift`, `fx.radialBlur`, `fx.zoomBlur`, `fx.fishEye`, `fx.wave`, `fx.glass`, `fx.ripple`, `fx.pinch`, `fx.polar`, `fx.dropShadow`, `fx.reflection`, `fx.roundCorners`, `fx.instantFrame`, `fx.vignetteFrame`
- **Browse** (40): `browse.thumbnails`, `browse.browser`, `browse.folderTree`, `browse.favorites`, `browse.recursive`, `browse.thumbSize`, `browse.viewMode`, `browse.sort`, `browse.groupBy`, `browse.filter`, `browse.showAllFiles`, `browse.openArchive`, `browse.timeline`, `browse.map`, `browse.people`, `browse.albums`, `browse.smartAlbum`, `browse.addToAlbum`, `browse.rate`, `browse.colorLabel`, `browse.favorite`, `browse.pick`, `browse.reject`, `browse.unflag`, `browse.selectPattern`, `browse.selectRejected`, `browse.findDuplicates`, `browse.findSimilar`, `browse.searchSketch`, `browse.searchColor`, `browse.qualitySort`, `browse.cull`, `browse.stacks`, `browse.lightTable`, `browse.catalog`, `browse.watchFolder`, `browse.folderManager`, `browse.maintenance`, `browse.newFolder`, `browse.refresh`
- **Metadata** (25): `meta.iptc`, `meta.xmp`, `meta.comment`, `meta.caption`, `meta.keywords`, `meta.copyright`, `meta.regions`, `meta.template`, `meta.copyFrom`, `meta.diff`, `meta.sidecarMode`, `meta.shiftDate`, `meta.geotag`, `meta.geotagGpx`, `meta.reverseGeocode`, `meta.removeGps`, `meta.strip`, `meta.privacyCheck`, `meta.provenance`, `meta.checksum`, `meta.fixity`, `meta.citation`, `meta.personLink`, `meta.exportCsv`, `meta.importCsv`
- **Batch** (13): `batch.convert`, `batch.rename`, `batch.actions`, `batch.recipe`, `batch.queue`, `batch.metadata`, `batch.lossless`, `batch.watermark`, `batch.webPresets`, `batch.multipage`, `batch.optimize`, `batch.dryRun`, `batch.undo`
- **Create** (17): `create.contactSheet`, `create.panoramaJoin`, `create.panoramaStitch`, `create.imageStrip`, `create.collage`, `create.movie`, `create.animation`, `create.multipage`, `create.webGallery`, `create.calendar`, `create.photoBook`, `create.focusStack`, `create.hdr`, `create.icon`, `create.comparison`, `create.extractFrames`, `create.extractEmbedded`
- **Pages and Frames** (8): `pages.insert`, `pages.delete`, `pages.extract`, `pages.reorder`, `frames.editor`, `frames.reverse`, `frames.loopCount`, `frames.optimize`
- **RAW** (4): `raw.preview`, `raw.develop`, `raw.preferPreview`, `raw.extractPreview`
- **View** (33): `view.nextFolder`, `view.previousFolder`, `view.fullScreenDisplay`, `view.frameless`, `view.filmstrip`, `view.navigator`, `view.infoPane`, `view.language`, `view.loupe`, `view.copyColor`, `view.histogramOverlay`, `view.clipping`, `view.focusPeaking`, `view.osd`, `view.osdTemplate`, `view.rulers`, `view.grid`, `view.measure`, `view.colorManaged`, `view.displayAdjust`, `view.grayscalePreview`, `view.colorBlindSim`, `view.stereo`, `view.sphere`, `view.twoPage`, `view.rtl`, `view.compare`, `view.compareSplit`, `view.diffOverlay`, `view.syncWindows`, `view.mediaPlay`, `view.mediaFrame`, `view.motionPhoto`
- **Slideshow** (13): `show.start`, `show.fromCurrent`, `show.settings`, `show.transition`, `show.timing`, `show.loop`, `show.random`, `show.music`, `show.captions`, `show.pause`, `show.kiosk`, `show.remote`, `show.exportHtml`
- **Tools** (14): `tools.ocr`, `tools.ocrToPen`, `tools.readCode`, `tools.makeQr`, `tools.docCleanup`, `tools.restoreWizard`, `tools.preflight`, `tools.printCalc`, `tools.paletteExtract`, `tools.vectorize`, `tools.compareFolders`, `tools.backup`, `tools.plugins`, `tools.external`
- **AI** (56): `ai.generate`, `ai.variations`, `ai.sketchToImage`, `ai.generateWithRefs`, `ai.generateBackground`, `ai.generateVector`, `ai.generateTile`, `ai.imageToPrompt`, `ai.generateCompare`, `ai.promptLibrary`, `ai.editInstruction`, `ai.fill`, `ai.erase`, `ai.expand`, `ai.replace`, `ai.removeBackground`, `ai.replaceBackground`, `ai.blurBackground`, `ai.relight`, `ai.recolor`, `ai.restyle`, `ai.upscale`, `ai.deblur`, `ai.denoise`, `ai.colorize`, `ai.repairDamage`, `ai.removeReflection`, `ai.translateText`, `ai.combineGroupShots`, `ai.smartCrop`, `ai.selectSubject`, `ai.selectByPrompt`, `ai.depth`, `ai.describe`, `ai.altText`, `ai.ask`, `ai.autoTag`, `ai.caption`, `ai.transcribe`, `ai.identify`, `ai.estimateDate`, `ai.cullAssist`, `ai.searchContent`, `ai.findSimilarSemantic`, `ai.batch`, `ai.contentCredentials`, `ai.history`, `ai.setup`, `ai.providers`, `ai.active`, `ai.privacy`, `ai.ensembleMode`, `ai.ensembleMembers`, `ai.showDeliberation`, `ai.stop`, `ai.deleteModels`
- **Developer** (2): `dev.console`, `dev.cliHelp`
