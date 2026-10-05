#!/usr/bin/env node
/**
 * Installe (ou désinstalle avec --uninstall) le programme d'aide aux mises à jour de Wiky-Traders.
 *
 *   Depuis le dépôt :            npm run updater:install
 *   Depuis un zip décompressé :  node <dossier de l'extension>/updater/install.mjs
 *   Identifiant précis :         … --id <identifiant affiché dans les réglages de l'extension>
 *
 * Écrit ~/.wiky-traders/ (lanceur, configuration, manifeste) et enregistre le programme auprès des navigateurs
 * Chromium (Chrome, Arc, Brave, Edge, Chromium) : fichier dans leur dossier NativeMessagingHosts (macOS, Linux)
 * ou clé de registre (Windows).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'com.wikytraders.updater';
const here = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const os = platform();
const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const ids = args.flatMap((a, i) => (a === '--id' && args[i + 1] ? [args[i + 1]] : []));

/** Identifiant d'une extension non empaquetée : SHA-256 de son chemin absolu, 32 premiers chiffres hexa en a–p. */
export function unpackedId(path) {
  const bytes = os === 'win32' ? Buffer.from(path, 'utf16le') : Buffer.from(path, 'utf8');
  const hex = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return [...hex].map((d) => String.fromCharCode(97 + parseInt(d, 16))).join('');
}

// Mode : dépôt git (scripts/updater du dépôt, ou dist/updater d'un dépôt) ou extension décompressée (zip).
let mode;
let dir;
let extDir;
let hostScript;
if (basename(dirname(here)) === 'scripts' && existsSync(join(here, '..', '..', '.git'))) {
  mode = 'git';
  dir = resolve(here, '..', '..');
  extDir = join(dir, 'dist');
  hostScript = join(here, 'host.mjs');
} else if (basename(dirname(here)) === 'dist' && existsSync(join(here, '..', '..', '.git'))) {
  mode = 'git';
  dir = resolve(here, '..', '..');
  extDir = join(dir, 'dist');
  hostScript = join(dir, 'scripts', 'updater', 'host.mjs');
} else {
  mode = 'zip';
  dir = resolve(here, '..');
  extDir = dir;
  hostScript = join(here, 'host.mjs');
}

const base = join(home, '.wiky-traders');
const manifestDirs =
  os === 'darwin'
    ? ['Google/Chrome', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data'].map((p) => join(home, 'Library/Application Support', p))
    : os === 'linux'
      ? ['google-chrome', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'].map((p) => join(home, '.config', p))
      : [];
const regKeys = ['Software\\Google\\Chrome', 'Software\\Microsoft\\Edge', 'Software\\BraveSoftware\\Brave-Browser', 'Software\\Chromium'].map((k) => `HKCU\\${k}\\NativeMessagingHosts\\${NAME}`);

if (uninstall) {
  for (const d of manifestDirs) rmSync(join(d, 'NativeMessagingHosts', `${NAME}.json`), { force: true });
  if (os === 'win32') for (const k of regKeys) try { execFileSync('reg', ['delete', k, '/f'], { stdio: 'ignore' }); } catch { /* absente */ }
  rmSync(base, { recursive: true, force: true });
  console.log('✔ Programme d\'aide aux mises à jour désinstallé.');
  process.exit(0);
}

const realExt = existsSync(extDir) ? realpathSync(extDir) : extDir;
const allowed = [...new Set([...ids, unpackedId(realExt), unpackedId(extDir)])];
mkdirSync(base, { recursive: true });
writeFileSync(join(base, 'config.json'), JSON.stringify({ mode, dir, extDir }, null, 2));

// Lanceur : chemin absolu de Node (les navigateurs lancés depuis le Dock n'ont pas le PATH du terminal).
const node = process.execPath;
let launcher;
if (os === 'win32') {
  launcher = join(base, 'updater.bat');
  writeFileSync(launcher, `@echo off\r\nset "PATH=${dirname(node)};%PATH%"\r\nset "WIKY_UPDATER_CONFIG=${join(base, 'config.json')}"\r\n"${node}" "${hostScript}"\r\n`);
} else {
  launcher = join(base, 'updater.sh');
  writeFileSync(
    launcher,
    `#!/bin/sh\nexport PATH="${dirname(node)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"\nexport WIKY_UPDATER_CONFIG="${join(base, 'config.json')}"\nexec "${node}" "${hostScript}"\n`,
  );
  chmodSync(launcher, 0o755);
}

const manifest = {
  name: NAME,
  description: 'Wiky-Traders – mises à jour',
  path: launcher,
  type: 'stdio',
  allowed_origins: allowed.map((id) => `chrome-extension://${id}/`),
};
const manifestFile = join(base, `${NAME}.json`);
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

const done = [];
for (const d of manifestDirs) {
  if (!existsSync(d)) continue;
  mkdirSync(join(d, 'NativeMessagingHosts'), { recursive: true });
  writeFileSync(join(d, 'NativeMessagingHosts', `${NAME}.json`), JSON.stringify(manifest, null, 2));
  done.push(d.split(/[\\/]/).slice(-2).join('/'));
}
if (os === 'win32') {
  for (const k of regKeys) {
    try {
      execFileSync('reg', ['add', k, '/ve', '/t', 'REG_SZ', '/d', manifestFile, '/f'], { stdio: 'ignore' });
      done.push(k.split('\\')[2]);
    } catch {
      /* navigateur absent */
    }
  }
}

console.log(`✔ Programme d'aide installé (${mode === 'git' ? 'dépôt git' : 'extension décompressée'} : ${dir})`);
console.log(`  Navigateurs : ${done.length ? done.join(', ') : 'aucun trouvé'}`);
console.log(`  Extension autorisée : ${allowed.join(', ')}`);
console.log('  Recharge l\'extension (↻) puis clique sur « Mettre à jour » dans les réglages Wiky-Traders.');
if (!ids.length) console.log('  Si le bouton dit que le programme est introuvable, relance avec : --id <identifiant affiché dans les réglages>');
