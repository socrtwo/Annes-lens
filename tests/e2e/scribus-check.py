# Opens an IDML (or other) file in Scribus headless and writes what it found as JSON beside it:
# pages, and per page the picture frames (with an image loaded) and the text. Used by smoke.mjs:
#   xvfb-run -a scribus -g -ns -py tests/e2e/scribus-check.py file.idml
import scribus, sys, json
f = sys.argv[1]
scribus.openDoc(f)
out = {'pages': scribus.pageCount(), 'size': [round(v) for v in scribus.getPageSize()], 'images': [], 'texts': []}
for p in range(1, scribus.pageCount() + 1):
    scribus.gotoPage(p)
    for name, typ, order in scribus.getPageItems():
        if typ == 2: out['images'].append([p, bool(scribus.getImageFile(name)), [round(v, 3) for v in scribus.getImageScale(name)]])
        if typ == 4: out['texts'].append([p, scribus.getAllText(name).strip()])
open(f + '.json', 'w').write(json.dumps(out))
scribus.closeDoc()
