// Construit l'extension dans dist/ :
//  - pages (popup, options, journal) en ESM classique,
//  - service worker en module ES,
//  - content script en IIFE (les content scripts MV3 ne peuvent pas être des modules).
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const watch = process.argv.includes('--watch') ? {} : null;
const r = (p) => resolve(root, p);

/** Version construite : commit de la branche (pour la vérification des mises à jour). */
function gitInfo() {
  const run = (cmd) => execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return { sha: run('git rev-parse HEAD'), dirty: run('git status --porcelain --untracked-files=no') !== '', date: run('git log -1 --format=%cI') };
  } catch {
    return { sha: process.env.GITHUB_SHA ?? null, dirty: false, date: null };
  }
}
const buildInfo = { ...gitInfo(), builtAt: new Date().toISOString() };

const common = {
  configFile: false,
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'), __WIKY_BUILD__: JSON.stringify(buildInfo) },
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

// Version et programme d'aide aux mises à jour (aussi dans le zip, pour une installation sans le dépôt).
writeFileSync(r('dist/build.json'), JSON.stringify(buildInfo, null, 2));
mkdirSync(r('dist/updater'), { recursive: true });
cpSync(r('scripts/updater'), r('dist/updater'), { recursive: true });

if (!watch) console.log('✔ Extension construite dans dist/');
