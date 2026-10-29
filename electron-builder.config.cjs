// electron-builder configuration for the desktop releases.
// Windows: NSIS installer (x64, arm64) and a portable .exe (x64).
// macOS: universal (Apple silicon + Intel) .dmg and .zip, ad-hoc signed.
// Linux: AppImage and .deb for x64, arm64 (Raspberry Pi OS 64-bit, ChromeOS Linux on ARM) and
// armv7l (Raspberry Pi OS 32-bit).
/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.socrtwo.quilllens',
  productName: 'Anne\'s Lens',
  executableName: 'QuillLens', // the binary keeps its old name; the product (display) name is Anne's Lens
  copyright: 'Anne\'s Lens contributors, MIT License',
  directories: { app: 'build/desktop-app', output: 'release', buildResources: 'resources' },
  artifactName: 'QuillLens-${version}-${os}-${arch}.${ext}',
  asar: true,
  // Everything the app needs is bundled into dist/ by Vite; ship no node_modules.
  files: ['dist/**/*', 'electron/**/*', 'package.json', '!**/node_modules/**'],
  icon: 'resources/icon-1024.png',
  fileAssociations: [
    { ext: ['jpg', 'jpeg', 'jpe', 'jfif'], name: 'JPEG Picture', role: 'Editor', mimeType: 'image/jpeg' },
    { ext: ['png', 'apng'], name: 'PNG Picture', role: 'Editor', mimeType: 'image/png' },
    { ext: 'gif', name: 'GIF Picture', role: 'Editor', mimeType: 'image/gif' },
    { ext: 'webp', name: 'WebP Picture', role: 'Editor', mimeType: 'image/webp' },
    { ext: 'avif', name: 'AVIF Picture', role: 'Viewer', mimeType: 'image/avif' },
    { ext: ['heic', 'heif'], name: 'HEIF Picture', role: 'Viewer', mimeType: 'image/heic' },
    { ext: ['bmp', 'dib'], name: 'Bitmap Picture', role: 'Editor', mimeType: 'image/bmp' },
    { ext: ['ico', 'cur'], name: 'Icon', role: 'Viewer', mimeType: 'image/x-icon' },
    { ext: ['tif', 'tiff'], name: 'TIFF Picture', role: 'Editor', mimeType: 'image/tiff' },
    { ext: ['svg', 'svgz'], name: 'SVG Picture', role: 'Viewer', mimeType: 'image/svg+xml' },
    { ext: ['tga', 'tpic'], name: 'Targa Picture', role: 'Editor', mimeType: 'image/x-tga' },
    { ext: ['pnm', 'ppm', 'pgm', 'pbm', 'pam', 'pfm'], name: 'Netpbm Picture', role: 'Editor', mimeType: 'image/x-portable-anymap' },
    { ext: 'qoi', name: 'QOI Picture', role: 'Editor', mimeType: 'image/qoi' },
    { ext: ['pcx', 'dcx'], name: 'PCX Picture', role: 'Viewer', mimeType: 'image/x-pcx' },
    { ext: ['xpm', 'xbm'], name: 'X Pixmap', role: 'Viewer', mimeType: 'image/x-xpixmap' },
    { ext: 'wbmp', name: 'Wireless Bitmap', role: 'Editor', mimeType: 'image/vnd.wap.wbmp' },
    { ext: ['psd', 'psb'], name: 'Photoshop Picture', role: 'Viewer', mimeType: 'image/vnd.adobe.photoshop' },
    { ext: 'icns', name: 'Apple Icon', role: 'Viewer', mimeType: 'image/icns' },
    { ext: 'dds', name: 'DirectDraw Surface', role: 'Viewer', mimeType: 'image/vnd-ms.dds' },
    { ext: ['hdr', 'pic', 'rgbe'], name: 'Radiance HDR Picture', role: 'Viewer', mimeType: 'image/vnd.radiance' },
    { ext: ['dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'pef', 'srw', '3fr', 'iiq', 'x3f'], name: 'Camera RAW Picture', role: 'Viewer', mimeType: 'image/x-raw' },
  ],

  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }, { target: 'portable', arch: ['x64'] }],
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, artifactName: 'QuillLens-${version}-windows-${arch}-setup.${ext}' },
  portable: { artifactName: 'QuillLens-${version}-windows-portable.${ext}' },
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],
    category: 'public.app-category.productivity',
    extendInfo: { CFBundleDisplayName: 'Anne\'s Lens' },
    // Ad-hoc signature: runs on Apple silicon without a paid Developer ID, but is not notarized,
    // so Gatekeeper asks once (docs/INSTALL.md). Hardened runtime would reject Electron's own signature.
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
  },
  linux: {
    target: [{ target: 'AppImage', arch: ['x64', 'arm64', 'armv7l'] }, { target: 'deb', arch: ['x64', 'arm64', 'armv7l'] }],
    category: 'Graphics;Viewer;Photography',
    synopsis: 'Fast picture viewer, organizer and converter',
    description: 'Anne\'s Lens is an open-source picture viewer, organizer and converter in the tradition of IrfanView: fast, keyboard-driven, and able to open almost anything. Every feature is a command you can put on the ribbon, the Quick Access Bar, a classic menu, a shortcut or a macro.',
    maintainer: 'socrtwo <socrtwo@users.noreply.github.com>',
    executableName: 'quilllens',
    syncDesktopName: true,
  },
  publish: null,
};
