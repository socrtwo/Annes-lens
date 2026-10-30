/**
 * A small PDF writer for pictures: one page per picture, each a JPEG (DCTDecode) or raw RGB
 * (FlateDecode-free, uncompressed) image object drawn to fit the page, with optional captions in the
 * base Helvetica font. Enough for contact sheets, multipage exports and "Export as PDF".
 */
export interface PdfPage { /** JPEG bytes, or raw RGB samples with `raw: true`. */ image: Uint8Array; raw?: boolean; width: number; height: number; /** Page size in points (default: the image at 72 dpi, capped to A4 proportions when `fit` is given). */ pageWidth?: number; pageHeight?: number; margin?: number; caption?: string }

const enc = new TextEncoder();
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => Math.min(255, c.charCodeAt(0))));
function concat(parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const pdfString = (s: string) => '(' + s.replace(/[\\()]/g, (m) => '\\' + m).replace(/[^\x20-\x7e]/g, '?') + ')';

export function makePdf(pages: PdfPage[], opts: { title?: string; producer?: string } = {}): Uint8Array {
  const objects: Uint8Array[] = [];
  const add = (body: string | Uint8Array[]) => { objects.push(typeof body === 'string' ? enc.encode(body) : concat(body)); return objects.length; };
  const kidsIds: number[] = [];
  const pagesId = 1 + pages.length * 3 + 1; // catalog is last
  let fontId = 0;
  if (pages.some((p) => p.caption)) fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const ids: number[] = [];
  for (const p of pages) {
    const pw = p.pageWidth || p.width * 0.75, ph = p.pageHeight || p.height * 0.75, m = p.margin ?? 0;
    const capH = p.caption ? 14 : 0;
    const availW = pw - 2 * m, availH = ph - 2 * m - capH;
    const k = Math.min(availW / p.width, availH / p.height);
    const w = p.width * k, h = p.height * k, x = m + (availW - w) / 2, y = m + capH + (availH - h) / 2;
    const imgDict = `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${p.raw ? '' : '/Filter /DCTDecode '}/Length ${p.image.length} >>`;
    const imgId = add([enc.encode(imgDict + '\nstream\n'), p.image, enc.encode('\nendstream')]);
    let content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    if (p.caption && fontId) content += `\nBT /F1 10 Tf ${(m + 2).toFixed(2)} ${(m + 3).toFixed(2)} Td ${pdfString(p.caption)} Tj ET`;
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${imgId} 0 R >> ${fontId ? `/Font << /F1 ${fontId} 0 R >> ` : ''}>> /Contents ${contentId} 0 R >>`);
    ids.push(pageId); kidsIds.push(pageId);
  }
  const realPagesId = add(`<< /Type /Pages /Kids [${kidsIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${kidsIds.length} >>`);
  // Pages referenced a predicted id; patch when the prediction was off (a font object shifts ids by one).
  if (realPagesId !== pagesId) for (const id of ids) objects[id - 1] = enc.encode(new TextDecoder().decode(objects[id - 1]).replace(`/Parent ${pagesId} 0 R`, `/Parent ${realPagesId} 0 R`));
  const infoId = add(`<< /Producer ${pdfString(opts.producer || "Anne's Lens")} ${opts.title ? `/Title ${pdfString(opts.title)} ` : ''}>>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`);
  const parts: Uint8Array[] = [enc.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let offset = parts[0].length; const offsets: number[] = [];
  objects.forEach((body, i) => { const head = enc.encode(`${i + 1} 0 obj\n`), tail = enc.encode('\nendobj\n'); offsets.push(offset); parts.push(head, body, tail); offset += head.length + body.length + tail.length; });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(latin1(xref));
  return concat(parts);
}

/** Paper sizes in points. */
export const PAPER_PT: Record<string, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
