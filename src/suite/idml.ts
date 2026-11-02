/**
 * An IDML writer (InDesign Markup Language, the open interchange format that InDesign, Affinity
 * Publisher and Scribus open) for Send to Anne's Press and Photo Book: pages of picture frames
 * with the pictures embedded, caption text frames in a "Caption" paragraph style, alt text on each
 * picture frame, single pages or facing-page spreads. Units are points; page coordinates have the
 * origin at the top-left corner of the page.
 */
import { writeZip } from '../picture/batch';
import { crc32 } from '../meta/metaWrite';

/** Sets a PNG's pHYs chunk (pixels per meter) so every reader takes the same resolution (some assume 100 ppi without it). */
export function withPngPpi(png: Uint8Array, ppi: number): Uint8Array {
  if (png[0] !== 0x89 || png[1] !== 0x50) return png;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength), ppm = Math.round(ppi / 0.0254);
  const chunk = new Uint8Array(21), cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); cv.setUint32(8, ppm); cv.setUint32(12, ppm); chunk[16] = 1; cv.setUint32(17, crc32(chunk, 4, 17));
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let p = 8, placed = false;
  while (p + 12 <= png.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...png.subarray(p + 4, p + 8)), end = p + 12 + len;
    if (type !== 'pHYs') parts.push(png.subarray(p, end));
    if (type === 'IHDR' && !placed) { parts.push(chunk); placed = true; }
    p = end; if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

export interface IdmlImage { data: Uint8Array; mime: 'image/jpeg' | 'image/png'; width: number; height: number; name: string; alt?: string; /** The file's pixels per inch (72 when unknown): its native size in points is pixels × 72 / ppi. */ ppi?: number }
export type IdmlFrame =
  /** The picture is fitted inside the slot, centered; the frame is the fitted picture (no crop to interpret). */
  | { kind: 'image'; x: number; y: number; w: number; h: number; image: IdmlImage }
  | { kind: 'text'; x: number; y: number; w: number; h: number; text: string; style?: 'Caption' | 'Title' | 'Body'; align?: 'left' | 'center' | 'right' };
export interface IdmlPage { frames: IdmlFrame[] }
export interface IdmlDoc { width: number; height: number; margin?: number; facing?: boolean; title?: string; pages: IdmlPage[]; captionFont?: string; titleFont?: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const enc = (s: string) => new TextEncoder().encode(s);
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PKG = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="16.0"';
const n2 = (v: number) => String(Math.round(v * 1000) / 1000);
const b64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const path = (x0: number, y0: number, x1: number, y1: number) => `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${[[x0, y0], [x0, y1], [x1, y1], [x1, y0]].map(([x, y]) => `<PathPointType Anchor="${n2(x)} ${n2(y)}" LeftDirection="${n2(x)} ${n2(y)}" RightDirection="${n2(x)} ${n2(y)}"/>`).join('')}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;

/** Spreads: facing documents pair pages 2–3, 4–5… after a first right-hand page. */
export function spreadsOf(doc: IdmlDoc): number[][] {
  const n = doc.pages.length, out: number[][] = [];
  if (!doc.facing) { for (let i = 0; i < n; i++) out.push([i]); return out; }
  out.push([0]); for (let i = 1; i < n; i += 2) out.push(i + 1 < n ? [i, i + 1] : [i]);
  return out;
}

export function buildIdml(doc: IdmlDoc): Uint8Array {
  const W = doc.width, H = doc.height, m = doc.margin ?? 36;
  let id = 0; const uid = (p: string) => `${p}${(++id).toString(36)}`;
  const stories: { self: string; xml: string }[] = [];
  const spreads: { self: string; xml: string }[] = [];
  spreadsOf(doc).forEach((pageIdx) => {
    const sid = uid('s');
    let body = '';
    pageIdx.forEach((pi, k) => {
      // Spread space: the origin sits on the binding edge at the page's vertical middle.
      const left = doc.facing ? (pageIdx.length === 2 ? (k === 0 ? -W : 0) : pi % 2 === 1 ? -W : 0) : 0;
      const tx = left, ty = -H / 2, pid = uid('p');
      body += `<Page Self="${pid}" Name="${pi + 1}" AppliedMaster="um" GeometricBounds="0 0 ${n2(H)} ${n2(W)}" ItemTransform="1 0 0 1 ${n2(tx)} ${n2(ty)}" MasterPageTransform="1 0 0 1 0 0" OverrideList=""><Properties><PageColor type="enumeration">UseMasterColor</PageColor></Properties><MarginPreference ColumnCount="1" ColumnGutter="12" Top="${m}" Bottom="${m}" Left="${m}" Right="${m}" ColumnDirection="Horizontal" ColumnsPositions="0 ${n2(W - 2 * m)}"/></Page>`;
      for (const f of doc.pages[pi].frames) {
        if (f.kind === 'image') {
          const im = f.image, rid = uid('r'), iid = uid('i'), ppi = im.ppi || 72;
          const nw = (im.width * 72) / ppi, nh = (im.height * 72) / ppi; // native size, points
          const k2 = Math.min(f.w / nw, f.h / nh), iw = nw * k2, ih = nh * k2;
          const ix = tx + f.x + (f.w - iw) / 2, iy = ty + f.y + (f.h - ih) / 2;
          const x0 = ix, y0 = iy, x1 = ix + iw, y1 = iy + ih;
          const fmt = im.mime === 'image/png' ? '$ID/PNG' : '$ID/JPEG';
          const alt = im.alt ? `<ObjectExportOption AltTextSourceType="SourceCustom" ActualTextSourceType="SourceFromStructure" CustomAltText="${esc(im.alt)}" CustomActualText="$ID/" ApplyTagType="TagFromStructure" ImageConversionType="JPEG" ImageExportResolution="Ppi300" CustomImageConversion="false"/>` : '';
          body += `<Rectangle Self="${rid}" Name="${esc(im.name)}" ContentType="GraphicType" ItemLayer="uL" StrokeWeight="0" FillColor="Swatch/None" StrokeColor="Swatch/None" Locked="false" Visible="true" ItemTransform="1 0 0 1 0 0" AppliedObjectStyle="ObjectStyle/$ID/[Normal Graphics Frame]">${path(x0, y0, x1, y1)}${alt}<FrameFittingOption FittingOnEmptyFrame="None" FittingAlignment="CenterAnchor" LeftCrop="0" TopCrop="0" RightCrop="0" BottomCrop="0"/><${im.mime === 'image/png' ? 'Image' : 'Image'} Self="${iid}" ItemTransform="${n2(k2)} 0 0 ${n2(k2)} ${n2(ix)} ${n2(iy)}" ImageTypeName="${im.mime === 'image/png' ? '$ID/Portable Network Graphics (PNG)' : '$ID/JPEG'}" ActualPpi="${n2(ppi)} ${n2(ppi)}" EffectivePpi="${n2(ppi / k2)} ${n2(ppi / k2)}" Space="$ID/#Links_RGB" LocalDisplaySetting="Default"><Properties><Profile type="string">$ID/Embedded</Profile><GraphicBounds Left="0" Top="0" Right="${n2(nw)}" Bottom="${n2(nh)}"/><Contents><![CDATA[${b64(im.mime === 'image/png' ? withPngPpi(im.data, ppi) : im.data)}]]></Contents></Properties><Link Self="${uid('l')}" AssetURL="$ID/" AssetID="$ID/" LinkResourceURI="file:${encodeURI(im.name)}" LinkResourceFormat="${fmt}" StoredState="Embedded" LinkClassID="35906" LinkClientID="257" LinkResourceModified="false" LinkObjectModified="false" ShowInUI="true" CanEmbed="true" CanUnembed="true" CanPackage="true" ImportPolicy="NoAutoImport" ExportPolicy="NoAutoExport" LinkImportStamp="" LinkImportModificationTime="2026-01-01T00:00:00" LinkImportTime="2026-01-01T00:00:00" LinkResourceSize="0~${im.data.length.toString(16)}"/></Image></Rectangle>`;
        } else {
          const x0 = tx + f.x, y0 = ty + f.y, x1 = x0 + f.w, y1 = y0 + f.h;
          const tid = uid('t'), story = uid('u'), style = f.style || 'Caption';
          const just = f.align === 'left' ? 'LeftAlign' : f.align === 'right' ? 'RightAlign' : 'CenterAlign';
          body += `<TextFrame Self="${tid}" ParentStory="${story}" PreviousTextFrame="n" NextTextFrame="n" ContentType="TextType" ItemLayer="uL" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="0" Visible="true" Locked="false" ItemTransform="1 0 0 1 0 0" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]">${path(x0, y0, x1, y1)}<TextFramePreference TextColumnCount="1" VerticalJustification="TopAlign" AutoSizingType="Off"/></TextFrame>`;
          const paras = f.text.split('\n').map((t, i, a) => `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}" Justification="${just}"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${esc(t)}</Content>${i < a.length - 1 ? '<Br/>' : ''}</CharacterStyleRange></ParagraphStyleRange>`).join('');
          stories.push({ self: story, xml: `${HEAD}<idPkg:Story ${PKG}><Story Self="${story}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n"><StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType" StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>${paras}</Story></idPkg:Story>` });
        }
      }
    });
    spreads.push({ self: sid, xml: `${HEAD}<idPkg:Spread ${PKG}><Spread Self="${sid}" PageCount="${pageIdx.length}" BindingLocation="${doc.facing ? (pageIdx.length === 2 ? 1 : pageIdx[0] % 2 === 1 ? 1 : 0) : 0}" AllowPageShuffle="true" ItemTransform="1 0 0 1 0 0" ShowMasterItems="true" PageTransitionType="None">${body}</Spread></idPkg:Spread>` });
  });
  const captionFont = doc.captionFont || 'Minion Pro', titleFont = doc.titleFont || 'Myriad Pro';
  const styles = `${HEAD}<idPkg:Styles ${PKG}><RootCharacterStyleGroup Self="u79"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Imported="false" Name="$ID/[No character style]"/></RootCharacterStyleGroup><RootParagraphStyleGroup Self="u7a"><ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" Imported="false" FillColor="Color/Black" PointSize="12" AppliedFont="${captionFont}" FontStyle="Regular"/><ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" Imported="false"><Properties><BasedOn type="object">ParagraphStyle/$ID/[No paragraph style]</BasedOn></Properties></ParagraphStyle><ParagraphStyle Self="ParagraphStyle/Body" Name="Body" PointSize="11" Leading="14"><Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn><Leading type="unit">14</Leading></Properties></ParagraphStyle><ParagraphStyle Self="ParagraphStyle/Caption" Name="Caption" PointSize="9.5" FontStyle="Italic" Justification="CenterAlign"><Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn><Leading type="unit">12</Leading></Properties></ParagraphStyle><ParagraphStyle Self="ParagraphStyle/Title" Name="Title" PointSize="30" AppliedFont="${titleFont}" FontStyle="Regular" Justification="CenterAlign"><Properties><BasedOn type="object">ParagraphStyle/$ID/NormalParagraphStyle</BasedOn><Leading type="unit">36</Leading></Properties></ParagraphStyle></RootParagraphStyleGroup><RootCellStyleGroup Self="u7b"><CellStyle Self="CellStyle/$ID/[None]" Name="$ID/[None]"/></RootCellStyleGroup><RootTableStyleGroup Self="u7c"><TableStyle Self="TableStyle/$ID/[No table style]" Name="$ID/[No table style]"/></RootTableStyleGroup><RootObjectStyleGroup Self="u7d"><ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]"/><ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]"><Properties><BasedOn type="object">ObjectStyle/$ID/[None]</BasedOn></Properties></ObjectStyle><ObjectStyle Self="ObjectStyle/$ID/[Normal Text Frame]" Name="$ID/[Normal Text Frame]"><Properties><BasedOn type="object">ObjectStyle/$ID/[None]</BasedOn></Properties></ObjectStyle></RootObjectStyleGroup></idPkg:Styles>`;
  const graphic = `${HEAD}<idPkg:Graphic ${PKG}><Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" ColorOverride="Specialblack" Name="Black" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/><Color Self="Color/Paper" Model="Process" Space="CMYK" ColorValue="0 0 0 0" ColorOverride="Specialpaper" Name="Paper" ColorEditable="true" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/><Color Self="Color/Registration" Model="Registration" Space="CMYK" ColorValue="100 100 100 100" ColorOverride="Specialregistration" Name="Registration" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/><Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/><StrokeStyle Self="StrokeStyle/$ID/Solid" Name="$ID/Solid"/></idPkg:Graphic>`;
  const fonts = `${HEAD}<idPkg:Fonts ${PKG}>${[captionFont, titleFont].filter((f, i, a) => a.indexOf(f) === i).map((f, i) => `<FontFamily Self="di${i}" Name="${esc(f)}"><Font Self="di${i}Font" FontFamily="${esc(f)}" Name="${esc(f)}" PostScriptName="${esc(f.replace(/\s+/g, ''))}" Status="NotAvailable" FontStyleName="Regular" FontType="OpenTypeCFF" WritingScript="0" FullName="${esc(f)}" FullNameNative="${esc(f)}" FontStyleNameNative="Regular" PlatformName="$ID/" Version=""/></FontFamily>`).join('')}</idPkg:Fonts>`;
  const prefs = `${HEAD}<idPkg:Preferences ${PKG}><DocumentPreference PageHeight="${n2(H)}" PageWidth="${n2(W)}" PagesPerDocument="${doc.pages.length}" FacingPages="${!!doc.facing}" DocumentBleedTopOffset="0" DocumentBleedBottomOffset="0" DocumentBleedInsideOrLeftOffset="0" DocumentBleedOutsideOrRightOffset="0" DocumentBleedUniformSize="true" AllowPageShuffle="true" PageBinding="LeftToRight" ColumnDirection="Horizontal" Intent="PrintIntent" CreateLinkedTextFrame="false"/><MarginPreference ColumnCount="1" ColumnGutter="12" Top="${m}" Bottom="${m}" Left="${m}" Right="${m}" ColumnDirection="Horizontal" ColumnsPositions="0 ${n2(W - 2 * m)}"/><ViewPreference HorizontalMeasurementUnits="Points" VerticalMeasurementUnits="Points"/></idPkg:Preferences>`;
  const master = `${HEAD}<idPkg:MasterSpread ${PKG}><MasterSpread Self="um" Name="A-Master" NamePrefix="A" BaseName="Master" ShowMasterItems="true" PageCount="${doc.facing ? 2 : 1}" ItemTransform="1 0 0 1 0 0">${(doc.facing ? [-W, 0] : [0]).map((tx, i) => `<Page Self="um${i}" Name="${doc.facing ? (i ? 'A' : 'A') : 'A'}" AppliedMaster="n" GeometricBounds="0 0 ${n2(H)} ${n2(W)}" ItemTransform="1 0 0 1 ${n2(tx)} ${n2(-H / 2)}" MasterPageTransform="1 0 0 1 0 0"><MarginPreference ColumnCount="1" ColumnGutter="12" Top="${m}" Bottom="${m}" Left="${m}" Right="${m}" ColumnDirection="Horizontal" ColumnsPositions="0 ${n2(W - 2 * m)}"/></Page>`).join('')}</MasterSpread></idPkg:MasterSpread>`;
  const design = `${HEAD}<?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="16.0(32)" ?>\n<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="16.0" Self="d" StoryList="${stories.map((s) => s.self).join(' ')}" Name="${esc(doc.title || 'Pictures')}.indd" ZeroPoint="0 0" ActiveLayer="uL" CMYKProfile="U.S. Web Coated (SWOP) v2" RGBProfile="sRGB IEC61966-2.1" SolidColorIntent="UseColorSettings" AfterBlendingIntent="UseColorSettings" DefaultImageIntent="UseColorSettings" RGBPolicy="PreserveEmbeddedProfiles" CMYKPolicy="CombinationOfPreserveAndSafeCmyk" AccurateLABSpots="false"><Language Self="Language/$ID/English%3a USA" Name="$ID/English: USA" SingleQuotes="‘’" DoubleQuotes="“”" PrimaryLanguageName="$ID/English" SublanguageName="$ID/USA" Id="269" HyphenationVendor="Hunspell" SpellingVendor="Hunspell"/><idPkg:Graphic src="Resources/Graphic.xml"/><idPkg:Fonts src="Resources/Fonts.xml"/><idPkg:Styles src="Resources/Styles.xml"/><idPkg:Preferences src="Resources/Preferences.xml"/><Layer Self="uL" Name="Layer 1" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"><Properties><LayerColor type="enumeration">LightBlue</LayerColor></Properties></Layer><idPkg:MasterSpread src="MasterSpreads/MasterSpread_um.xml"/>${spreads.map((s) => `<idPkg:Spread src="Spreads/Spread_${s.self}.xml"/>`).join('')}<idPkg:BackingStory src="XML/BackingStory.xml"/>${stories.map((s) => `<idPkg:Story src="Stories/Story_${s.self}.xml"/>`).join('')}</Document>`;
  const container = `${HEAD}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles></container>`;
  const backing = `${HEAD}<idPkg:BackingStory ${PKG}><XmlStory Self="ubs" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"/></ParagraphStyleRange></XmlStory></idPkg:BackingStory>`;
  return writeZip([
    { name: 'mimetype', data: enc('application/vnd.adobe.indesign-idml-package') }, // first and stored, as the format requires
    { name: 'designmap.xml', data: enc(design) },
    { name: 'META-INF/container.xml', data: enc(container) },
    { name: 'Resources/Graphic.xml', data: enc(graphic) },
    { name: 'Resources/Fonts.xml', data: enc(fonts) },
    { name: 'Resources/Styles.xml', data: enc(styles) },
    { name: 'Resources/Preferences.xml', data: enc(prefs) },
    { name: 'MasterSpreads/MasterSpread_um.xml', data: enc(master) },
    ...spreads.map((s) => ({ name: `Spreads/Spread_${s.self}.xml`, data: enc(s.xml) })),
    ...stories.map((s) => ({ name: `Stories/Story_${s.self}.xml`, data: enc(s.xml) })),
    { name: 'XML/BackingStory.xml', data: enc(backing) },
  ]);
}

export interface GridOptions { width: number; height: number; margin?: number; perPage: 1 | 2 | 4; captions?: boolean; coverTitle?: string; coverSubtitle?: string; gutter?: number }
/** Pages of pictures in a grid (1, 2 or 4 a page; two stack on a portrait page and sit side by side on a landscape one), captions under each, an optional title page. */
export function gridPages(items: { image: IdmlImage; caption?: string }[], o: GridOptions): IdmlPage[] {
  const W = o.width, H = o.height, m = o.margin ?? 36, g = o.gutter ?? 18, capH = o.captions ? 26 : 0;
  const pages: IdmlPage[] = [];
  if (o.coverTitle) pages.push({ frames: [{ kind: 'text', x: m, y: H * 0.38, w: W - 2 * m, h: 48, text: o.coverTitle, style: 'Title' }, ...(o.coverSubtitle ? [{ kind: 'text' as const, x: m, y: H * 0.38 + 56, w: W - 2 * m, h: 30, text: o.coverSubtitle, style: 'Caption' as const }] : [])] });
  const cols = o.perPage === 4 ? 2 : o.perPage === 2 && W > H ? 2 : 1, rows = o.perPage / cols;
  const cw = (W - 2 * m - (cols - 1) * g) / cols, ch = (H - 2 * m - (rows - 1) * g) / rows;
  for (let i = 0; i < items.length; i += o.perPage) {
    const frames: IdmlFrame[] = [];
    items.slice(i, i + o.perPage).forEach((it, k) => {
      const x = m + (k % cols) * (cw + g), y = m + Math.floor(k / cols) * (ch + g);
      frames.push({ kind: 'image', x, y, w: cw, h: ch - capH, image: it.image });
      if (o.captions && it.caption) frames.push({ kind: 'text', x, y: y + ch - capH + 4, w: cw, h: capH - 4, text: it.caption, style: 'Caption' });
    });
    pages.push({ frames });
  }
  return pages;
}
/** Book and page sizes in points (width × height). */
export const BOOK_SIZES: Record<string, { label: string; w: number; h: number }> = {
  square8: { label: '8 × 8 in square', w: 576, h: 576 },
  square12: { label: '12 × 12 in square', w: 864, h: 864 },
  land11: { label: '11 × 8.5 in landscape', w: 792, h: 612 },
  land10: { label: '10 × 8 in landscape', w: 720, h: 576 },
  letter: { label: 'Letter portrait (8.5 × 11 in)', w: 612, h: 792 },
  a4: { label: 'A4 portrait', w: 595.28, h: 841.89 },
  a4land: { label: 'A4 landscape', w: 841.89, h: 595.28 },
};
