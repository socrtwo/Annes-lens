/** Metadata commands available in M1: the EXIF viewer. */
import { def } from './registry';
import { openDialog, toast } from '../ui/dialog';
import { h } from '../ui/dom';

def([
  {
    id: 'meta.exif', icon: 'photo_camera', popular: true, noRecord: true, isEnabled: (app) => !!app.picture,
    tip: 'Camera, exposure, date and place, grouped and searchable; copy as text',
    run: async (app) => {
      const pic = app.picture!;
      const e = pic.exif;
      if (!e || !e.tags.length) { toast(`${pic.name} has no EXIF data.`); return; }
      const filter = h('input', { placeholder: 'Filter tags…', 'aria-label': 'Filter tags', style: 'width:100%' }) as HTMLInputElement;
      const table = h('table', { class: 'ql-stats qn-info' });
      const draw = () => {
        const q = filter.value.trim().toLowerCase();
        table.replaceChildren(...e.tags.filter((t) => !q || `${t.name} ${t.value}`.toLowerCase().includes(q)).map((t) => h('tr', null, h('td', null, t.name.replace(/([a-z])([A-Z])/g, '$1 $2')), h('td', null, t.value))));
      };
      filter.addEventListener('input', draw);
      draw();
      const summary = [e.make || e.model ? `${[e.make, e.model].filter(Boolean).join(' ')}` : '', e.exposure, e.dateTaken, e.gps ? `${e.gps.lat.toFixed(5)}, ${e.gps.lon.toFixed(5)}` : ''].filter(Boolean).join(' · ');
      await openDialog({ title: `EXIF — ${pic.name}`, wide: true, content: h('div', null, summary ? h('p', { class: 'ql-help' }, summary) : null, filter, h('div', { style: 'max-height:55vh;overflow:auto;margin-top:6px' }, table)), cancel: false, ok: 'Close', buttons: [
        { label: 'Copy', onClick: () => { navigator.clipboard?.writeText(e.tags.map((t) => `${t.name}\t${t.value}`).join('\n')); toast('Copied'); } },
        ...(e.gps ? [{ label: 'Map', onClick: () => { import('../platform/native').then(({ openExternal }) => openExternal(`https://www.openstreetmap.org/?mlat=${e.gps!.lat}&mlon=${e.gps!.lon}#map=16/${e.gps!.lat}/${e.gps!.lon}`)); } }] : []),
      ] });
    },
  },
]);
