"""Render WMF/EMF files to PNG at exact pixel sizes through LibreOffice's GraphicProvider (UNO): lo_render.py src dst width height [...]."""
import subprocess, sys, time, uno, os
from com.sun.star.beans import PropertyValue
def pv(n, v): p = PropertyValue(); p.Name = n; p.Value = v; return p
proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore', '--accept=socket,host=127.0.0.1,port=2099;urp;'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ctx = None
for _ in range(60):
    try:
        local = uno.getComponentContext(); res = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        ctx = res.resolve('uno:socket,host=127.0.0.1,port=2099;urp;StarOffice.ComponentContext'); break
    except Exception: time.sleep(0.5)
gp = ctx.ServiceManager.createInstanceWithContext('com.sun.star.graphic.GraphicProvider', ctx)
for src, dst, w, h in zip(sys.argv[1::4], sys.argv[2::4], sys.argv[3::4], sys.argv[4::4]):
    g = gp.queryGraphic((pv('URL', uno.systemPathToFileUrl(os.path.abspath(src))),))
    gp.storeGraphic(g, (pv('URL', uno.systemPathToFileUrl(os.path.abspath(dst))), pv('MimeType', 'image/png'), pv('FilterData', (pv('PixelWidth', int(w)), pv('PixelHeight', int(h))))))
    print('wrote', dst)
try: ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx).terminate()
except Exception: pass
proc.wait(timeout=30)
