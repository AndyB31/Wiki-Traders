// Construit l'extension dans dist/ :
//  - pages (popup, options, journal) en ESM classique,
//  - service worker en module ES,
//  - content script en IIFE (les content scripts MV3 ne peuvent pas être des modules).
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const watch = process.argv.includes('--watch') ? {} : null;
const r = (p) => resolve(root, p);

const common = {
  configFile: false,
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

await build({
  ...common,
  root: r('src/ui'),
  base: './',
  publicDir: r('public'),
  build: {
    outDir: r('dist'),
    emptyOutDir: true,
    target: 'es2022',
    watch,
    rollupOptions: {
      input: {
        popup: r('src/ui/popup.html'),
        options: r('src/ui/options.html'),
        journal: r('src/ui/journal.html'),
      },
    },
  },
});

await build({
  ...common,
  publicDir: false,
  build: {
    outDir: r('dist'),
    emptyOutDir: false,
    target: 'es2022',
    watch,
    lib: { entry: r('src/background/index.ts'), formats: ['es'], fileName: () => 'background.js' },
  },
});

await build({
  ...common,
  publicDir: false,
  build: {
    outDir: r('dist'),
    emptyOutDir: false,
    target: 'es2022',
    watch,
    lib: { entry: r('src/content/index.ts'), formats: ['iife'], name: 'WikyTraders', fileName: () => 'content.js' },
  },
});

await build({
  ...common,
  publicDir: false,
  build: {
    outDir: r('dist'),
    emptyOutDir: false,
    target: 'es2022',
    watch,
    lib: { entry: r('src/content/bridge.ts'), formats: ['iife'], name: 'WikyBridge', fileName: () => 'bridge.js' },
  },
});

if (!watch) console.log('✔ Extension construite dans dist/');
