import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { batchJobFor } from '../../src/platform/cli';
import { cliHelpText } from '../../src/commands/devConsole';

const require = createRequire(import.meta.url);
const { parseCli, usageText, OPTIONS } = require('../../electron/cli.cjs');

describe('desktop command line', () => {
  it('parses convert jobs with every step', () => {
    const o = parseCli(['--convert=out/*-web.jpg', '--resize', '1600x1200', '--rotate=exif', '--flip=h', '--gray', '--quality=80', '--strip', '--overwrite', '--shrink-only', 'a.png', 'Trip']);
    expect(o.errors).toEqual([]);
    expect([o.format, o.resizeSpec, o.rotate, o.flip, o.gray, o.quality, o.strip, o.overwrite, o['shrink-only'], o.inputs]).toEqual(['jpeg', { mode: 'box', value: 1600, value2: 1200 }, 'exif', 'h', true, '80', true, true, true, ['a.png', 'Trip']]);
    expect(parseCli(['--convert=*.png', '--resize=50%']).resizeSpec).toEqual({ mode: 'percent', value: 50 });
    expect(parseCli(['--convert=*.png', '--resize=x300']).resizeSpec).toEqual({ mode: 'height', value: 300 });
    expect(parseCli(['--convert=*.png', '--resize=640']).resizeSpec).toEqual({ mode: 'width', value: 640 });
    expect(parseCli(['--convert=*.qoi', '--long=2048']).resizeSpec).toEqual({ mode: 'long', value: 2048 });
  });
  it('reports usage errors and leaves Chromium switches alone', () => {
    const o = parseCli(['--no-sandbox', '--remote-debugging-port=0', '-f', 'x.jpg']);
    expect([o.errors, o.unknown, o.fullscreen, o.inputs]).toEqual([[], ['--no-sandbox', '--remote-debugging-port=0'], true, ['x.jpg']]);
    expect(parseCli(['--convert=out/x.png']).errors[0]).toMatch(/put \*/);
    expect(parseCli(['--convert=*.gif']).errors[0]).toMatch(/end the pattern/);
    expect(parseCli(['--convert=*.png', '--resize=big']).errors[0]).toMatch(/WxH/);
    expect(parseCli(['--convert=*.png', '--rotate=45']).errors[0]).toMatch(/90, 180, 270/);
    expect(parseCli(['--convert=*.png', '--quality=0']).errors[0]).toMatch(/1 to 100/);
    expect(parseCli(['--resize=50%']).errors[0]).toMatch(/works with --convert/);
    expect(parseCli(['--convert']).errors[0]).toMatch(/needs a value/);
    expect(parseCli(['--gray=1']).errors[0]).toMatch(/takes no value/);
    expect(parseCli(['--convert=*.png', '--resize=10', '--long=5']).errors).toContain('Use --resize or --long, not both');
  });
  it('help text lists every option, in the terminal and in the app', () => {
    const t = usageText('9.9'), u = cliHelpText();
    for (const x of OPTIONS) { expect(t).toContain(`--${x.name}`); expect(u).toContain(`--${x.name}`); expect(u).toContain(x.text); }
    expect(t.startsWith("Anne's Lens 9.9")).toBe(true);
  });
  it('maps a convert job onto the Batch engine', () => {
    const j = batchJobFor({ mode: 'convert', inputs: [{ uri: 'file:///p/a.png', name: 'a.png' }], format: 'webp', quality: 70, names: '{name}-small', resize: { mode: 'box', value: 100, value2: 80 }, shrinkOnly: true, rotate: '270', flip: 'v', gray: true, strip: true });
    expect([j.format, j.quality, j.keepMeta, j.names.pattern, j.steps.rotate, j.steps.resize, j.steps.grayscale, j.steps.actions, j.inputs[0].name]).toEqual(['webp', 70, false, '{name}-small', 'rot270', { mode: 'box', value: 100, value2: 80, kernel: 'lanczos3', onlyShrink: true }, true, [{ kind: 'flip', dir: 'v' }], 'a.png']);
  });
});
