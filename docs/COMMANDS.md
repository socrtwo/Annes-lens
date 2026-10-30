# Anne's Lens Command Reference

Anne's Lens has **368 commands** built, out of the **557** in the plan ([COMMANDS-PLAN.md](COMMANDS-PLAN.md)). Every built command can be placed on the Quick Access Bar, added to a custom tab, found in the classic menus, bound to a keyboard shortcut, recorded in a macro, or found with command search (Alt+Q). A command is registered only when it works; the rest of the plan is listed at the end of this file.

7 of the built commands are "Commands Not in the Tabs" (reachable through the Quick Access Bar chooser, Customize Tabs, the classic menus and command search), so nothing the app can do is hidden.

This file is generated from the source by `npm run catalog`; a unit test fails when it is out of date.

## Ribbon

The ribbon mirrors the plan: one tab per plan tab and one group per plan group, in the plan's order, plus the Home tab. Groups that have no built command yet are not shown.

- **Home**: Clipboard (4) · Navigate (5) · Rotate (5) · Quick fix (5) · Organize (7) · View (4) · Share (4)
- **File**: Open (14) · Save (7) · Export (4) · Files (10) · Acquire (2) · Print (6) · Share (2) · Close and options (10)
- **Edit**: Undo (3) · Clipboard (9) · Select (5) · Crop (5) · Add (5) · Paint and markup (1) · Find (1)
- **Image**: Information (4) · Rotate and flip (12) · Lossless JPEG (3) · Size (5) · Color depth and palette (9)
- **Adjust**: Automatic (6) · Tone (14) · Color (11) · Detail and retouch (9) · Presets and history (5)
- **Effects**: Browse (3) · Artistic (13) · Photographic (11) · Distort (14) · Frames and shadows (5)
- **Browse**: Views (5) · Rate and label (8) · Find and compare (3) · Catalog (1)
- **Metadata**: View and edit (11) · Date and place (3) · Privacy and integrity (5) · Records and genealogy (3)
- **Batch**: Batch (13)
- **Create**: Create (9)
- **Pages and Frames** (contextual): Pages (7) · Frames (8)
- **RAW** (contextual): RAW (3)
- **View**: Zoom (12) · Navigate (7) · Window (10) · Inspect (11) · Display (5) · Quick Access Bar and search (5)
- **Slideshow**: Slideshow (11)
- **Developer**: Developer (5)
- **Help**: Help (8)

## Classic menu layouts

| Layout | Modeled on | Built commands on the bar |
|---|---|---|
| IrfanView style (`irfanview`) | IrfanView 4.x main window (File, Edit, Image, Options, View, Help) | 130 |
| IrfanView Thumbnails style (`irfanview-thumbs`) | IrfanView 4.x thumbnail window | 27 |
| XnView style (`xnview`) | XnView MP browser and viewer | 99 |
| FastStone style (`faststone`) | FastStone Image Viewer | 72 |
| ACDSee style (`acdsee`) | ACDSee (Manage, View and Edit modes) | 47 |
| Windows Photo Viewer style (`photoviewer`) | Windows Photo Viewer and Microsoft Photos (toolbar commands as menus) | 30 |
| Picasa style (`picasa`) | Picasa 3 | 45 |
| Preview style (`preview`) | macOS Preview | 42 |
| digiKam style (`digikam`) | digiKam albums and image editor | 31 |
| All viewers combined (`all`) | the union of every layout above, merged menu by menu without duplicates (Picture, Modify and Item merge into Image; Go and Window into View; Album, Tag and Folder into Organize; Import and Export into File; Settings into Options) | 221 |
| Anne's Lens complete (`complete`) | the ribbon itself: one menu per tab, one submenu per group, every command | 368 |

## File (59 of 82)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Clear Recent Lists | Open |  | `file.clearRecent` | not in tabs |
| Open and Repair… | Open |  | `file.openRepair` | from the Anne's Office suite |
| Open as Hex | Open |  | `file.openHex` | from IrfanView, XnView Classic and XnView MP |
| Open as Text | Open |  | `file.openText` | from IrfanView |
| Open Folder… | Open | Ctrl+Shift+o | `file.openFolder` | from XnView Classic and XnView MP, FastStone Image Viewer, digiKam |
| Open in New Window | Open | Ctrl+n | `file.newWindow` | from nomacs, Preview, IrfanView |
| Open RAW Pixel Data… | Open |  | `file.openRawPixels` | from IrfanView |
| Open URL… | Open |  | `file.openUrl` | from IrfanView, XnView Classic and XnView MP |
| Open With (system) | Open |  | `file.openWith` | from Microsoft Photos, Preview, Android gallery apps |
| Open with External Editor | Open | Shift+e | `file.openExternal` | has options menu; from IrfanView, XnView Classic and XnView MP |
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
| Export Animation (GIF, WebP, APNG)… | Export |  | `file.export.animation` | from XnView Classic and XnView MP, new in Anne's Lens |
| Export as Icon (.ico, .icns)… | Export |  | `file.export.icon` | from Graphic Workshop, IrfanView |
| Export Metadata as CSV… | Export |  | `file.export.metadataCsv` | from XnView Classic and XnView MP, digiKam |
| Export Palette… | Export |  | `file.export.palette` | from IrfanView |
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
| Camera Capture | Acquire |  | `file.captureCamera` | from new in Anne's Lens |
| Screen Capture… | Acquire | c | `file.capture` | from IrfanView, Preview, FastStone Image Viewer |
| Print at True Size… | Print |  | `file.printTrueSize` | from new in Anne's Lens |
| Print Copies and Posters… | Print |  | `file.copyShop` | from IrfanView |
| Print Layouts (several per page)… | Print |  | `file.printLayouts` | from Windows Photo Viewer and Windows Picture and Fax Viewer, Microsoft Photos, Picasa, FastStone Image Viewer |
| Print Preview | Print |  | `file.printPreview` | from IrfanView, Microsoft Photos |
| Print Setup… | Print |  | `file.printSetup` | not in tabs; from IrfanView |
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

## Edit (30 of 55)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| History Panel | Undo | Ctrl+Alt+h | `edit.history` | from new in Anne's Lens |
| Redo | Undo | Ctrl+Shift+z | `edit.redo` | from most picture viewers |
| Undo | Undo | Ctrl+z | `edit.undo` | from IrfanView, most picture viewers |
| Clear Selection | Clipboard |  | `edit.clear` | from IrfanView |
| Copy | Clipboard | Ctrl+c | `edit.copy` | from IrfanView, most picture viewers |
| Cut | Clipboard | Ctrl+x | `edit.cut` | from IrfanView |
| Cut Outside Selection | Clipboard | Ctrl+Shift+x | `edit.cutOutside` | from IrfanView |
| Fill Selection… | Clipboard |  | `edit.fill` | from IrfanView, XnView Classic and XnView MP |
| Paste | Clipboard | Ctrl+v | `edit.paste` | from IrfanView, most picture viewers |
| Paste as New Picture | Clipboard | Ctrl+Shift+v | `edit.pasteAsNew` | from IrfanView, XnView Classic and XnView MP |
| Paste Beside | Clipboard |  | `edit.pasteBeside` | has options menu; from IrfanView |
| Paste into Selection | Clipboard |  | `edit.pasteInto` | from IrfanView |
| Custom Selection… | Select | Shift+c | `edit.customSelection` | from IrfanView |
| Maximize Selection to Aspect Ratio | Select |  | `edit.selectMaxAspect` | has options menu; from IrfanView |
| Rectangle Selection | Select |  | `edit.selectRect` | from most picture viewers |
| Select All | Select | Ctrl+a | `edit.selectAll` | from most picture viewers |
| Select None | Select | Ctrl+d | `edit.selectNone` | from most picture viewers |
| Selection Information | Select |  | `edit.selectionInfo` | not in tabs; from IrfanView |
| Auto Crop Borders | Crop | Shift+x | `edit.autoCrop` | from IrfanView |
| Crop for Print Size… | Crop |  | `edit.cropPrint` | from Picasa |
| Crop Page from Photo | Crop |  | `edit.cropPage` | from new in Anne's Lens |
| Crop Selection | Crop | Ctrl+y | `edit.crop` | from IrfanView |
| Crop to Aspect Ratio… | Crop |  | `edit.cropAspect` | from Microsoft Photos, Preview, Apple Photos and iPhoto |
| Add Border or Frame… | Add |  | `edit.border` | from IrfanView, FastStone Image Viewer |
| Change Canvas Size… | Add | Shift+v | `edit.canvasSize` | from IrfanView |
| Insert Text… | Add | Ctrl+t | `edit.insertText` | from IrfanView |
| Insert Watermark or Overlay… | Add |  | `edit.insertOverlay` | from IrfanView, FastStone Image Viewer |
| Signature… | Add |  | `edit.signature` | from Preview |
| Redact Region (blur, pixelate, black out) | Paint and markup |  | `edit.redact` | from FastStone Image Viewer, new in Anne's Lens |
| Go to File by Name | Find | Ctrl+Shift+g | `edit.gotoFile` | from new in Anne's Lens |

## Image (34 of 41)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Count Unique Colors | Information |  | `image.countColors` | from IrfanView |
| Estimate JPEG Quality | Information |  | `image.jpegQuality` | from XnView Classic and XnView MP, new in Anne's Lens |
| Histogram | Information | Shift+h | `image.histogram` | from IrfanView, XnView Classic and XnView MP, FastStone Image Viewer |
| Picture Information | Information | i | `image.info` | from IrfanView, most picture viewers |
| Show Channel | Information |  | `image.showChannel` | has options menu; not in tabs; from IrfanView, XnView Classic and XnView MP |
| Auto Straighten | Rotate and flip |  | `image.autoStraighten` | from Lightroom Classic (Library and Develop), new in Anne's Lens |
| Auto-Rotate by EXIF Orientation | Rotate and flip |  | `image.autoRotateExif` | from IrfanView, XnView Classic and XnView MP |
| Custom Rotation… | Rotate and flip | Ctrl+u | `image.rotateCustom` | from IrfanView |
| Deskew Scanned Page | Rotate and flip |  | `image.deskew` | from Kodak/Wang Imaging for Windows, new in Anne's Lens |
| Flip Horizontal | Rotate and flip | h | `image.flipH` | from IrfanView |
| Flip Vertical | Rotate and flip | v | `image.flipV` | from IrfanView |
| Lens Correction… | Rotate and flip |  | `image.lensCorrection` | from digiKam, Lightroom Classic (Library and Develop) |
| Perspective Correction… | Rotate and flip |  | `image.perspective` | from Lightroom Classic (Library and Develop), PhotoScape |
| Rotate 180° | Rotate and flip |  | `image.rotate180` |  |
| Rotate Left | Rotate and flip | l | `image.rotateLeft` | from IrfanView, most picture viewers |
| Rotate Right | Rotate and flip | r | `image.rotateRight` | from IrfanView, most picture viewers |
| Straighten | Rotate and flip |  | `image.straighten` | from Picasa, Microsoft Photos, Apple Photos and iPhoto |
| Lossless Auto-Rotate by EXIF | Lossless JPEG |  | `image.losslessAutoRotate` | from XnView Classic and XnView MP, FastStone Image Viewer |
| Lossless Crop | Lossless JPEG |  | `image.losslessCrop` | from IrfanView, XnView Classic and XnView MP |
| Lossless JPEG Transformations… | Lossless JPEG | Shift+j | `image.losslessJpeg` | from IrfanView, XnView Classic and XnView MP, FastStone Image Viewer |
| Double Size | Size | Shift+= | `image.doubleSize` | from IrfanView |
| Half Size | Size | Shift+- | `image.halfSize` | from IrfanView |
| Resize / Resample… | Size | Ctrl+r | `image.resize` | from IrfanView |
| Resize to Screen | Size |  | `image.resizeToScreen` | from IrfanView |
| Set Print Resolution (DPI)… | Size |  | `image.setDpi` | from IrfanView |
| Black and White (Threshold)… | Color depth and palette |  | `image.threshold` | from IrfanView |
| Convert to Grayscale | Color depth and palette | Ctrl+g | `image.grayscale` | from IrfanView |
| Decrease Color Depth… | Color depth and palette |  | `image.decreaseDepth` | from IrfanView |
| Flatten Transparency | Color depth and palette |  | `image.flatten` |  |
| Increase Color Depth | Color depth and palette |  | `image.increaseDepth` | from IrfanView |
| Negative | Color depth and palette | Ctrl+Shift+n | `image.negative` | has options menu; from IrfanView |
| Replace Color… | Color depth and palette |  | `image.replaceColor` | from IrfanView |
| Swap Color Channels | Color depth and palette |  | `image.swapChannels` | has options menu; from IrfanView |
| Transparent Color… | Color depth and palette |  | `image.transparentColor` | from IrfanView, Graphic Workshop |

## Adjust (45 of 47)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Auto Color | Automatic |  | `adjust.autoColor` | from XnView Classic and XnView MP |
| Auto Contrast | Automatic |  | `adjust.autoContrast` | from XnView Classic and XnView MP |
| Auto Levels | Automatic |  | `adjust.autoLevels` | from XnView Classic and XnView MP, FastStone Image Viewer |
| Auto White Balance | Automatic |  | `adjust.autoWhiteBalance` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Auto-Adjust Colors | Automatic | Shift+u | `adjust.auto` | from IrfanView |
| One-Click Enhance | Automatic | Ctrl+e | `adjust.enhance` | from Picasa, Microsoft Photos, Apple Photos and iPhoto |
| Brightness and Contrast… | Tone |  | `adjust.brightnessContrast` | from most picture viewers |
| Clarity… | Tone |  | `adjust.clarity` | from Apple Photos and iPhoto, Lightroom Classic (Library and Develop) |
| Color Corrections… | Tone | Shift+g | `adjust.colorCorrections` | from IrfanView |
| Curves… | Tone | Ctrl+Shift+u | `adjust.curves` | from FastStone Image Viewer, XnView Classic and XnView MP, digiKam |
| Dehaze… | Tone |  | `adjust.dehaze` | from Lightroom Classic (Library and Develop) |
| Equalize Histogram | Tone |  | `adjust.equalize` | from XnView Classic and XnView MP |
| Exposure… | Tone |  | `adjust.exposure` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Fill Light | Tone |  | `adjust.fillLight` | from Picasa |
| Gamma… | Tone |  | `adjust.gamma` | from IrfanView |
| Levels… | Tone | Ctrl+l | `adjust.levels` | from FastStone Image Viewer, XnView Classic and XnView MP |
| Normalize | Tone |  | `adjust.normalize` | from XnView Classic and XnView MP |
| Shadows and Highlights… | Tone |  | `adjust.shadowsHighlights` | from FastStone Image Viewer, Lightroom Classic (Library and Develop) |
| Tone Equalizer… | Tone |  | `adjust.toneEqualizer` | from ACDSee, JPEGView |
| Vignette… | Tone |  | `adjust.vignette` | from Apple Photos and iPhoto, Lightroom Classic (Library and Develop), FastStone Image Viewer |
| Apply LUT… | Color |  | `adjust.lut` | from new in Anne's Lens |
| Black-and-White Mixer… | Color |  | `adjust.bwMixer` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Channel Mixer… | Color |  | `adjust.channelMixer` | from XnView Classic and XnView MP, digiKam |
| Color Balance… | Color |  | `adjust.colorBalance` | from FastStone Image Viewer, XnView Classic and XnView MP |
| Hue, Saturation and Lightness… | Color |  | `adjust.hsl` | from XnView Classic and XnView MP, FastStone Image Viewer |
| Posterize… | Color |  | `adjust.posterize` | from XnView Classic and XnView MP |
| Selective Color… | Color |  | `adjust.selectiveColor` | from Apple Photos and iPhoto |
| Tint and Sepia… | Color |  | `adjust.tint` | from Picasa, XnView Classic and XnView MP |
| Vibrance… | Color |  | `adjust.vibrance` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Warmify | Color |  | `adjust.warmify` | from Picasa |
| White Balance… | Color |  | `adjust.whiteBalance` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Blur… | Detail and retouch |  | `adjust.blur` | from IrfanView |
| Descreen (moiré) | Detail and retouch |  | `adjust.descreen` | from new in Anne's Lens |
| Despeckle | Detail and retouch |  | `adjust.despeckle` | from XnView Classic and XnView MP |
| Noise Reduction… | Detail and retouch |  | `adjust.denoise` | from Lightroom Classic (Library and Develop), digiKam |
| Red-Eye Reduction | Detail and retouch | Shift+y | `adjust.redEye` | from IrfanView, Picasa, Microsoft Photos |
| Remove Dust and Scratches… | Detail and retouch |  | `adjust.dustScratches` | from new in Anne's Lens |
| Restore Faded Colors | Detail and retouch |  | `adjust.restoreFaded` | from new in Anne's Lens |
| Sharpen | Detail and retouch | Shift+s | `adjust.sharpen` | from IrfanView |
| Unsharp Mask… | Detail and retouch |  | `adjust.unsharp` | from IrfanView, XnView Classic and XnView MP |
| Apply Preset | Presets and history |  | `adjust.applyPreset` | has options menu; from Lightroom Classic (Library and Develop) |
| Before / After | Presets and history | \ | `adjust.beforeAfter` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Copy Adjustments | Presets and history | Ctrl+Shift+c | `adjust.copySettings` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Paste Adjustments | Presets and history | Ctrl+Alt+v | `adjust.pasteSettings` | from Lightroom Classic (Library and Develop), Apple Photos and iPhoto |
| Save Adjustment Preset… | Presets and history |  | `adjust.savePreset` | from Lightroom Classic (Library and Develop), FastStone Image Viewer |

## Effects (46 of 47)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Custom Filter (Convolution)… | Browse |  | `fx.convolution` | from IrfanView, XnView Classic and XnView MP |
| Effects Browser… | Browse |  | `fx.browser` | from IrfanView |
| Repeat Last Effect | Browse | Ctrl+Alt+r | `fx.repeatLast` | from new in Anne's Lens |
| 3-D Button | Artistic |  | `fx.button3d` | from IrfanView |
| Cartoon | Artistic |  | `fx.cartoon` | from FastStone Image Viewer |
| Edge Detect | Artistic |  | `fx.edgeDetect` | from IrfanView |
| Emboss | Artistic |  | `fx.emboss` | from IrfanView |
| Halftone | Artistic |  | `fx.halftone` | from new in Anne's Lens |
| Median | Artistic |  | `fx.median` | from IrfanView |
| Mosaic | Artistic |  | `fx.mosaic` | from XnView Classic and XnView MP |
| Oil Paint | Artistic |  | `fx.oilPaint` | from IrfanView |
| Pencil Sketch | Artistic |  | `fx.pencilSketch` | from FastStone Image Viewer |
| Pixelate | Artistic |  | `fx.pixelize` | from IrfanView |
| Solarize | Artistic |  | `fx.solarize` | from IrfanView |
| Tiles | Artistic |  | `fx.tiles` | from IrfanView |
| Watercolor | Artistic |  | `fx.watercolor` | from new in Anne's Lens |
| Add Noise | Photographic |  | `fx.noise` | from XnView Classic and XnView MP |
| Cross Process | Photographic |  | `fx.crossProcess` | from new in Anne's Lens |
| Duotone | Photographic |  | `fx.duotone` | from new in Anne's Lens |
| Film Grain | Photographic |  | `fx.filmGrain` | from Picasa |
| Focal Black and White | Photographic |  | `fx.focalBW` | from Picasa |
| Glow | Photographic |  | `fx.glow` | from Picasa |
| Graduated Tint | Photographic |  | `fx.graduatedTint` | from Picasa |
| Orton Glow | Photographic |  | `fx.orton` | from new in Anne's Lens |
| Soft Focus | Photographic |  | `fx.softFocus` | from Picasa |
| Tilt-Shift Miniature | Photographic |  | `fx.tiltShift` | from new in Anne's Lens |
| Toy Camera | Photographic |  | `fx.toyCamera` | from new in Anne's Lens |
| Explosion | Distort |  | `fx.explosion` | from IrfanView |
| Fisheye | Distort |  | `fx.fishEye` | from IrfanView |
| Fragment | Distort |  | `fx.fragment` | from IrfanView |
| Glass | Distort |  | `fx.glass` | from new in Anne's Lens |
| Pinch | Distort |  | `fx.pinch` | from XnView Classic and XnView MP |
| Polar Coordinates | Distort |  | `fx.polar` | from new in Anne's Lens |
| Radial Blur | Distort |  | `fx.radialBlur` | from IrfanView |
| Rain Drops | Distort |  | `fx.rain` | from IrfanView |
| Ripple | Distort |  | `fx.ripple` | from XnView Classic and XnView MP |
| Shift Lines | Distort |  | `fx.shift` | from IrfanView |
| Spread | Distort |  | `fx.spread` | from IrfanView |
| Swirl | Distort |  | `fx.swirl` | from IrfanView |
| Wave | Distort |  | `fx.wave` | from IrfanView |
| Zoom Blur | Distort |  | `fx.zoomBlur` | from IrfanView |
| Drop Shadow | Frames and shadows |  | `fx.dropShadow` | from FastStone Image Viewer |
| Instant-Print Frame | Frames and shadows |  | `fx.instantFrame` | from Picasa |
| Reflection | Frames and shadows |  | `fx.reflection` | from FastStone Image Viewer |
| Round Corners | Frames and shadows |  | `fx.roundCorners` | from FastStone Image Viewer |
| Vignette Frame | Frames and shadows |  | `fx.vignetteFrame` | from FastStone Image Viewer |

## Browse (17 of 40)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Open Archive as Folder | Views |  | `browse.openArchive` | from Honeyview, XnView Classic and XnView MP |
| Sort By | Views |  | `browse.sort` | has options menu; from IrfanView, XnView Classic and XnView MP |
| Thumbnail Size | Views |  | `browse.thumbSize` | has options menu; from IrfanView, XnView Classic and XnView MP |
| Thumbnails | Views | t | `browse.thumbnails` | from IrfanView |
| View Mode | Views |  | `browse.viewMode` | has options menu; from XnView Classic and XnView MP, ACDSee |
| Color Label | Rate and label |  | `browse.colorLabel` | has options menu; from XnView Classic and XnView MP, Lightroom Classic (Library and Develop), ACDSee |
| Favorite | Rate and label | Ctrl+Shift+8 | `browse.favorite` | from Picasa, Apple Photos and iPhoto, Google Photos |
| Pick | Rate and label |  | `browse.pick` | from Lightroom Classic (Library and Develop), FastPictureViewer |
| Rating | Rate and label |  | `browse.rate` | has options menu; from XnView Classic and XnView MP, Lightroom Classic (Library and Develop), ACDSee |
| Reject | Rate and label |  | `browse.reject` | from Lightroom Classic (Library and Develop), FastPictureViewer |
| Select by Pattern… | Rate and label |  | `browse.selectPattern` | from XnView Classic and XnView MP |
| Select Rejected | Rate and label |  | `browse.selectRejected` | from Lightroom Classic (Library and Develop) |
| Unflag | Rate and label |  | `browse.unflag` | from Lightroom Classic (Library and Develop) |
| Find Duplicates… | Find and compare |  | `browse.findDuplicates` | from XnView Classic and XnView MP, digiKam, gThumb, ThumbsPlus |
| Find Similar Pictures… | Find and compare |  | `browse.findSimilar` | from XnView Classic and XnView MP, digiKam, Geeqie (GQview) |
| Sort by Quality | Find and compare |  | `browse.qualitySort` | from digiKam |
| Refresh | Catalog | F5 | `browse.refresh` | from XnView Classic and XnView MP, IrfanView |

## Metadata (22 of 26)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Comment… | View and edit |  | `meta.comment` | from IrfanView |
| Compare Metadata | View and edit |  | `meta.diff` | from new in Anne's Lens |
| Copy Metadata From… | View and edit |  | `meta.copyFrom` | from XnView Classic and XnView MP |
| Creator and Copyright… | View and edit |  | `meta.copyright` | from XnView Classic and XnView MP, digiKam |
| EXIF Information | View and edit | e | `meta.exif` | from IrfanView, most picture viewers |
| IPTC Information… | View and edit |  | `meta.iptc` | from IrfanView, XnView Classic and XnView MP |
| Keywords… | View and edit | Ctrl+k | `meta.keywords` | from digiKam, XnView Classic and XnView MP, Lightroom Classic (Library and Develop) |
| Metadata Template… | View and edit |  | `meta.template` | from digiKam, Lightroom Classic (Library and Develop), XnView Classic and XnView MP |
| Title and Caption… | View and edit | Ctrl+Shift+t | `meta.caption` | from Picasa, digiKam, Apple Photos and iPhoto |
| Write Sidecar or Embed | View and edit |  | `meta.sidecarMode` | has options menu; from digiKam, Lightroom Classic (Library and Develop) |
| XMP… | View and edit |  | `meta.xmp` | from XnView Classic and XnView MP, digiKam |
| Change Date Taken… | Date and place |  | `meta.shiftDate` | from IrfanView, XnView Classic and XnView MP, digiKam |
| Remove Location | Date and place |  | `meta.removeGps` | from Microsoft Photos, new in Anne's Lens |
| Set Location… | Date and place |  | `meta.geotag` | from Picasa, digiKam, XnView Classic and XnView MP |
| Checksum… | Privacy and integrity |  | `meta.checksum` | from new in Anne's Lens |
| Content Credentials | Privacy and integrity |  | `meta.provenance` | from new in Anne's Lens |
| Fixity Report… | Privacy and integrity |  | `meta.fixity` | from new in Anne's Lens |
| Privacy Check | Privacy and integrity |  | `meta.privacyCheck` | from new in Anne's Lens |
| Strip Metadata… | Privacy and integrity |  | `meta.strip` | from XnView Classic and XnView MP, FastStone Image Viewer |
| Export Metadata as CSV… | Records and genealogy |  | `meta.exportCsv` | from XnView Classic and XnView MP, digiKam |
| Import Metadata from CSV… | Records and genealogy |  | `meta.importCsv` | from new in Anne's Lens |
| Source Citation… | Records and genealogy |  | `meta.citation` | from Archive and genealogy tools (handwriting transcription, photo dating, restoration), new in Anne's Lens |

## Batch (13 of 13)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Batch Conversion and Rename… | Batch | b | `batch.convert` | from IrfanView |
| Batch Lossless JPEG… | Batch |  | `batch.lossless` | from IrfanView, XnView Classic and XnView MP |
| Batch Metadata… | Batch |  | `batch.metadata` | from XnView Classic and XnView MP, digiKam |
| Batch Multipage… | Batch |  | `batch.multipage` | from IrfanView |
| Batch Queue | Batch |  | `batch.queue` | from digiKam |
| Batch Rename… | Batch | Ctrl+b | `batch.rename` | from IrfanView, XnView Classic and XnView MP, FastStone Image Viewer |
| Batch Steps… | Batch |  | `batch.actions` | from IrfanView, XnView Classic and XnView MP |
| Batch Watermark… | Batch |  | `batch.watermark` | from FastStone Image Viewer, XnView Classic and XnView MP |
| Optimize Files… | Batch |  | `batch.optimize` | from IrfanView, new in Anne's Lens |
| Preview Batch (Dry Run) | Batch |  | `batch.dryRun` | from new in Anne's Lens |
| Recipe Editor… | Batch |  | `batch.recipe` | from XnView Classic and XnView MP, digiKam |
| Undo Last Batch | Batch |  | `batch.undo` | from new in Anne's Lens |
| Web and Email Sizes… | Batch |  | `batch.webPresets` | has options menu; from Windows Photo Viewer and Windows Picture and Fax Viewer, Picasa |

## Create (9 of 17)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Animation from Pictures… | Create |  | `create.animation` | from XnView Classic and XnView MP, new in Anne's Lens |
| Collage… | Create |  | `create.collage` | from Picasa, Windows Live Photo Gallery, Google Photos |
| Comparison Picture… | Create |  | `create.comparison` | from new in Anne's Lens |
| Contact Sheet… | Create |  | `create.contactSheet` | from IrfanView, XnView Classic and XnView MP, FastStone Image Viewer, Preview |
| Extract All Frames… | Create |  | `create.extractFrames` | from IrfanView |
| Icon Set… | Create |  | `create.icon` | from new in Anne's Lens |
| Image Strip… | Create |  | `create.imageStrip` | from XnView Classic and XnView MP, FastStone Image Viewer |
| Join Side by Side… | Create |  | `create.panoramaJoin` | from IrfanView, FastStone Image Viewer |
| Multipage TIFF or PDF… | Create |  | `create.multipage` | from IrfanView |

## Pages and Frames (15 of 15)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Delete Page | Pages |  | `pages.delete` | from IrfanView |
| Extract Pages… | Pages |  | `pages.extract` | from IrfanView |
| Go to Page… | Pages |  | `pages.goto` | from IrfanView |
| Insert Pages… | Pages |  | `pages.insert` | from IrfanView |
| Next Page | Pages | Ctrl+PageDown | `pages.next` | from IrfanView |
| Previous Page | Pages | Ctrl+PageUp | `pages.previous` | from IrfanView |
| Reorder Pages… | Pages |  | `pages.reorder` | from IrfanView |
| Animation Speed | Frames |  | `frames.speed` | has options menu; from new in Anne's Lens |
| Frame Editor… | Frames |  | `frames.editor` | from XnView Classic and XnView MP, new in Anne's Lens |
| Loop Count… | Frames |  | `frames.loopCount` | from XnView Classic and XnView MP |
| Next Frame | Frames | . | `frames.next` | from XnView Classic and XnView MP |
| Optimize Animation | Frames |  | `frames.optimize` | from new in Anne's Lens |
| Play / Pause Animation | Frames | Ctrl+Space | `frames.play` | from IrfanView, XnView Classic and XnView MP |
| Previous Frame | Frames |  | `frames.previous` | from XnView Classic and XnView MP |
| Reverse Frames | Frames |  | `frames.reverse` | from new in Anne's Lens |

## RAW (3 of 4)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Extract Embedded Preview | RAW |  | `raw.extractPreview` | from new in Anne's Lens |
| Show Embedded Preview | RAW |  | `raw.preview` | from IrfanView, XnView Classic and XnView MP, FastStone Image Viewer |
| Use Embedded Preview by Default | RAW |  | `raw.preferPreview` | from IrfanView, FastStone Image Viewer |

## View (51 of 72)

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
| Zoom In | Zoom | = | `view.zoomIn` | from IrfanView, most picture viewers |
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
| Clipping Warnings | Inspect | j | `view.clipping` | from Lightroom Classic (Library and Develop) |
| Copy Color Under Pointer | Inspect | Ctrl+Shift+p | `view.copyColor` | from ImageGlass, IrfanView |
| Focus Peaking | Inspect |  | `view.focusPeaking` | from FastRawViewer |
| Grid and Guides | Inspect |  | `view.grid` | has options menu; from new in Anne's Lens |
| Histogram Overlay | Inspect | Shift+o | `view.histogramOverlay` | from FastStone Image Viewer, XnView Classic and XnView MP |
| Information Overlay | Inspect | Ctrl+Alt+o | `view.osd` | from ImageGlass, FastStone Image Viewer, XnView Classic and XnView MP |
| Loupe | Inspect | z | `view.loupe` | from FastStone Image Viewer, Preview, Lightroom Classic (Library and Develop) |
| Overlay Template… | Inspect |  | `view.osdTemplate` | from XnView Classic and XnView MP |
| Pixel Grid | Inspect |  | `view.pixelGrid` | from new in Anne's Lens |
| Pixel Information | Inspect |  | `view.pixelInfo` | from IrfanView, ImageGlass |
| Rulers | Inspect |  | `view.rulers` | from new in Anne's Lens |
| Background Color… | Display |  | `view.background` | from IrfanView |
| Color-Blindness Simulation | Display |  | `view.colorBlindSim` | has options menu; from new in Anne's Lens |
| Display Adjustments | Display |  | `view.displayAdjust` | from JPEGView, new in Anne's Lens |
| Grayscale Preview | Display |  | `view.grayscalePreview` | from new in Anne's Lens |
| Transparency Display | Display |  | `view.alphaDisplay` | has options menu; from XnView Classic and XnView MP, ImageGlass |
| Add All Choices to Quick Access Bar | Quick Access Bar and search |  | `view.qatAddAll` | from the Anne's Office suite |
| Hide Quick Access Bar | Quick Access Bar and search |  | `view.qatHide` | from the Anne's Office suite |
| Quick Access Bar Labels | Quick Access Bar and search |  | `view.qatLabels` | from the Anne's Office suite |
| Quick Access Bar Position | Quick Access Bar and search |  | `view.qatPosition` | has options menu; from the Anne's Office suite |
| Search Commands | Quick Access Bar and search | Alt+q | `view.cmdSearch` | from the Anne's Office suite |
| Show Quick Access Bar | Quick Access Bar and search |  | `view.qatShow` | not in tabs; from the Anne's Office suite |

## Slideshow (11 of 13)

| Command | Group | Shortcut | ID | Notes |
|---|---|---|---|---|
| Captions | Slideshow |  | `show.captions` | from IrfanView, XnView Classic and XnView MP |
| Export as HTML Slideshow… | Slideshow |  | `show.exportHtml` | from FastStone Image Viewer, IrfanView |
| Kiosk Mode | Slideshow |  | `show.kiosk` | from new in Anne's Lens |
| Loop | Slideshow |  | `show.loop` | from IrfanView |
| Pause / Resume | Slideshow | Space | `show.pause` | from most picture viewers |
| Random Order | Slideshow |  | `show.random` | from IrfanView |
| Slideshow Settings… | Slideshow | w | `show.settings` | from IrfanView |
| Start from Current | Slideshow | Shift+F5 | `show.fromCurrent` |  |
| Start Slideshow | Slideshow | Ctrl+F5 | `show.start` | from IrfanView, most picture viewers |
| Timing | Slideshow |  | `show.timing` | has options menu; from IrfanView |
| Transition | Slideshow |  | `show.transition` | has options menu; from FastStone Image Viewer, Picasa, Google Photos |

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

## Planned, not yet built (189)

These ids are in the plan but have no command yet; they belong to later milestones ([ROADMAP.md](ROADMAP.md)). Nothing below is a placeholder in the app.

- **File** (23): `file.recoverAny`, `file.openEncrypted`, `file.saveSelection`, `file.encrypt`, `file.export.pdf`, `file.export.folio`, `file.export.stage`, `file.export.pen`, `file.export.press`, `file.copyAsFile`, `file.hide`, `file.sysProperties`, `file.scan`, `file.batchScan`, `file.selectSource`, `file.importCamera`, `file.importRules`, `file.wallpaper`, `file.lockScreen`, `file.contactPhoto`, `file.cast`, `file.customizeMenus`, `file.associations`
- **Edit** (25): `edit.selectInvert`, `edit.selectEllipse`, `edit.selectLasso`, `edit.selectWand`, `edit.selectColor`, `edit.paint`, `edit.markup`, `edit.callout`, `paint.brush`, `paint.pencil`, `paint.line`, `paint.arrow`, `paint.rect`, `paint.ellipse`, `paint.text`, `paint.eraser`, `paint.fill`, `paint.spray`, `paint.clone`, `paint.heal`, `paint.redEye`, `paint.colorReplace`, `paint.colorPicker`, `edit.flattenMarkup`, `edit.findFiles`
- **Image** (7): `image.seamCarve`, `image.paletteEdit`, `image.paletteImport`, `image.alphaFromMask`, `image.convertProfile`, `image.assignProfile`, `image.softProof`
- **Adjust** (2): `adjust.resetAll`, `adjust.revertOriginal`
- **Effects** (1): `fx.plugins8bf`
- **Browse** (23): `browse.browser`, `browse.folderTree`, `browse.favorites`, `browse.recursive`, `browse.groupBy`, `browse.filter`, `browse.showAllFiles`, `browse.timeline`, `browse.map`, `browse.people`, `browse.albums`, `browse.smartAlbum`, `browse.addToAlbum`, `browse.searchSketch`, `browse.searchColor`, `browse.cull`, `browse.stacks`, `browse.lightTable`, `browse.catalog`, `browse.watchFolder`, `browse.folderManager`, `browse.maintenance`, `browse.newFolder`
- **Metadata** (4): `meta.regions`, `meta.geotagGpx`, `meta.reverseGeocode`, `meta.personLink`
- **Create** (8): `create.panoramaStitch`, `create.movie`, `create.webGallery`, `create.calendar`, `create.photoBook`, `create.focusStack`, `create.hdr`, `create.extractEmbedded`
- **RAW** (1): `raw.develop`
- **View** (21): `view.nextFolder`, `view.previousFolder`, `view.fullScreenDisplay`, `view.frameless`, `view.filmstrip`, `view.navigator`, `view.infoPane`, `view.language`, `view.measure`, `view.colorManaged`, `view.stereo`, `view.sphere`, `view.twoPage`, `view.rtl`, `view.compare`, `view.compareSplit`, `view.diffOverlay`, `view.syncWindows`, `view.mediaPlay`, `view.mediaFrame`, `view.motionPhoto`
- **Slideshow** (2): `show.music`, `show.remote`
- **Tools** (14): `tools.ocr`, `tools.ocrToPen`, `tools.readCode`, `tools.makeQr`, `tools.docCleanup`, `tools.restoreWizard`, `tools.preflight`, `tools.printCalc`, `tools.paletteExtract`, `tools.vectorize`, `tools.compareFolders`, `tools.backup`, `tools.plugins`, `tools.external`
- **AI** (56): `ai.generate`, `ai.variations`, `ai.sketchToImage`, `ai.generateWithRefs`, `ai.generateBackground`, `ai.generateVector`, `ai.generateTile`, `ai.imageToPrompt`, `ai.generateCompare`, `ai.promptLibrary`, `ai.editInstruction`, `ai.fill`, `ai.erase`, `ai.expand`, `ai.replace`, `ai.removeBackground`, `ai.replaceBackground`, `ai.blurBackground`, `ai.relight`, `ai.recolor`, `ai.restyle`, `ai.upscale`, `ai.deblur`, `ai.denoise`, `ai.colorize`, `ai.repairDamage`, `ai.removeReflection`, `ai.translateText`, `ai.combineGroupShots`, `ai.smartCrop`, `ai.selectSubject`, `ai.selectByPrompt`, `ai.depth`, `ai.describe`, `ai.altText`, `ai.ask`, `ai.autoTag`, `ai.caption`, `ai.transcribe`, `ai.identify`, `ai.estimateDate`, `ai.cullAssist`, `ai.searchContent`, `ai.findSimilarSemantic`, `ai.batch`, `ai.contentCredentials`, `ai.history`, `ai.setup`, `ai.providers`, `ai.active`, `ai.privacy`, `ai.ensembleMode`, `ai.ensembleMembers`, `ai.showDeliberation`, `ai.stop`, `ai.deleteModels`
- **Developer** (2): `dev.console`, `dev.cliHelp`
