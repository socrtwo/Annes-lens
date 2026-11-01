/**
 * Minimal Office Open XML writers for the Anne's Office hand-offs: a Word document (Anne's Pen) with
 * each picture inline, its alt text (docPr descr) and title, and a "Caption" paragraph numbered as a
 * figure; a PowerPoint deck (Anne's Stage) with one picture per slide, the caption as the slide
 * title and the alt text on the picture. Both are plain ZIP packages any Office app opens.
 */
import { writeZip } from '../picture/batch';

export interface DocPicture {
  /** PNG or JPEG bytes. */
  data: Uint8Array; mime: 'image/png' | 'image/jpeg';
  width: number; height: number;
  /** Pixels per inch for the physical size (96 when unknown). */
  dpi?: number;
  name: string; caption?: string; alt?: string; title?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const enc = (s: string) => new TextEncoder().encode(s);
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const EMU_PER_INCH = 914400;
const ext = (m: DocPicture['mime']) => (m === 'image/png' ? 'png' : 'jpeg');
/** Fits a picture's physical size inside a box (EMU), keeping proportions and never enlarging past its own size. */
export function fitEmu(p: DocPicture, maxW: number, maxH: number): [number, number] {
  const dpi = p.dpi || 96, w = (p.width / dpi) * EMU_PER_INCH, h = (p.height / dpi) * EMU_PER_INCH, k = Math.min(1, maxW / w, maxH / h);
  return [Math.round(w * k), Math.round(h * k)];
}
const core = (title: string) => `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Anne's Lens</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"', R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// Word -------------------------------------------------------------------------------------------

export function buildDocx(pics: DocPicture[], o: { title?: string; numberFigures?: boolean; paper?: 'letter' | 'a4' } = {}): Uint8Array {
  const [pw, ph] = o.paper === 'a4' ? [11906, 16838] : [12240, 15840]; // twentieths of a point
  const margin = 1440, maxW = ((pw - 2 * margin) / 1440) * EMU_PER_INCH, maxH = ((ph - 2 * margin) / 1440) * EMU_PER_INCH * 0.8;
  let body = o.title ? `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${esc(o.title)}</w:t></w:r></w:p>` : '';
  const rels: string[] = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
  const media: { name: string; data: Uint8Array }[] = [];
  pics.forEach((p, i) => {
    const n = i + 1, rid = `rId${n + 1}`, file = `image${n}.${ext(p.mime)}`, [cx, cy] = fitEmu(p, maxW, maxH);
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`);
    media.push({ name: `word/media/${file}`, data: p.data });
    const descr = esc(p.alt || ''), title = esc(p.title || '');
    body += `<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${esc(p.name)}" descr="${descr}"${title ? ` title="${title}"` : ''}/><wp:cNvGraphicFramePr><a:graphicFrameLocks ${A} noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic ${A}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${esc(p.name)}" descr="${descr}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    if (p.caption || o.numberFigures) {
      const num = o.numberFigures ? `<w:r><w:t xml:space="preserve">Figure </w:t></w:r><w:fldSimple w:instr=" SEQ Figure \\* ARABIC "><w:r><w:t>${n}</w:t></w:r></w:fldSimple>${p.caption ? '<w:r><w:t xml:space="preserve">: </w:t></w:r>' : ''}` : '';
      body += `<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/></w:pPr>${num}${p.caption ? `<w:r><w:t xml:space="preserve">${esc(p.caption)}</w:t></w:r>` : ''}</w:p>`;
    }
  });
  const doc = `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ${R} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:color w:val="44546A"/><w:sz w:val="18"/></w:rPr></w:style></w:styles>`;
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  return writeZip([
    { name: '[Content_Types].xml', data: enc(types) },
    { name: '_rels/.rels', data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`) },
    { name: 'word/document.xml', data: enc(doc) },
    { name: 'word/styles.xml', data: enc(styles) },
    { name: 'word/_rels/document.xml.rels', data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) },
    { name: 'docProps/core.xml', data: enc(core(o.title || pics[0]?.name || 'Pictures')) },
    ...media,
  ]);
}

// PowerPoint -------------------------------------------------------------------------------------

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const THEME = `${XML}<a:theme ${A} name="Anne's Lens"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
const titleSp = (text: string | null, x: number, y: number, cx: number, cy: number) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></p:spPr>${text === null ? '' : `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody>`}</p:sp>`;

export function buildPptx(pics: DocPicture[], o: { title?: string; captionsAsTitles?: boolean } = {}): Uint8Array {
  const W = 12192000, H = 6858000, mx = 457200, titleY = 228600, titleH = 914400, top = titleY + titleH + 91440;
  const files: { name: string; data: Uint8Array }[] = [];
  const slideIds: string[] = [], presRels: string[] = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>'];
  const overrides: string[] = [];
  pics.forEach((p, i) => {
    const n = i + 1, file = `image${n}.${ext(p.mime)}`, title = o.captionsAsTitles !== false ? p.caption || p.title || '' : p.title || '';
    const hasTitle = !!title, y0 = hasTitle ? top : mx, [cx, cy] = fitEmu({ ...p, dpi: 1 }, W - 2 * mx, H - y0 - mx); // dpi 1: always fill the box
    const x = Math.round((W - cx) / 2), y = Math.round(y0 + (H - y0 - mx - cy) / 2);
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="3" name="${esc(p.name)}" descr="${esc(p.alt || '')}"${p.title ? ` title="${esc(p.title)}"` : ''}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    const slide = `${XML}<p:sld ${A} ${R} ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${hasTitle ? titleSp(title, mx, titleY, W - 2 * mx, titleH) : ''}${pic}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files.push({ name: `ppt/slides/slide${n}.xml`, data: enc(slide) });
    files.push({ name: `ppt/slides/_rels/slide${n}.xml.rels`, data: enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${file}"/></Relationships>`) });
    files.push({ name: `ppt/media/${file}`, data: p.data });
    presRels.push(`<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`);
    slideIds.push(`<p:sldId id="${255 + n}" r:id="rId${n + 2}"/>`);
    overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
  });
  const pres = `${XML}<p:presentation ${A} ${R} ${P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds.join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const master = `${XML}<p:sldMaster ${A} ${R} ${P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${titleSp(null, mx, titleY, W - 2 * mx, titleH)}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="3200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const layout = `${XML}<p:sldLayout ${A} ${R} ${P} type="titleOnly" preserve="1"><p:cSld name="Title Only"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${titleSp(null, mx, titleY, W - 2 * mx, titleH)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const rel = (type: string, target: string, id = 'rId1') => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (...r: string[]) => enc(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join('')}</Relationships>`);
  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${overrides.join('')}</Types>`;
  return writeZip([
    { name: '[Content_Types].xml', data: enc(types) },
    { name: '_rels/.rels', data: rels(rel('officeDocument', 'ppt/presentation.xml'), '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>') },
    { name: 'ppt/presentation.xml', data: enc(pres) },
    { name: 'ppt/_rels/presentation.xml.rels', data: rels(...presRels) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: enc(master) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels(rel('slideLayout', '../slideLayouts/slideLayout1.xml'), rel('theme', '../theme/theme1.xml', 'rId2')) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: enc(layout) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels(rel('slideMaster', '../slideMasters/slideMaster1.xml')) },
    { name: 'ppt/theme/theme1.xml', data: enc(THEME) },
    { name: 'docProps/core.xml', data: enc(core(o.title || 'Pictures')) },
    ...files,
  ]);
}
