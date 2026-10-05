#!/usr/bin/env node
/**
 * Programme d'aide aux mises à jour de Wiky-Traders (« native messaging » du navigateur).
 * Lancé par le navigateur à chaque demande de l'extension : lit un message JSON sur l'entrée standard,
 * répond un message JSON sur la sortie standard, puis s'arrête.
 *
 *  - { cmd: 'ping' }   → état : mode (dépôt git ou zip), dossier, version installée ;
 *  - { cmd: 'update' } → mode git : récupère la branche main (avance rapide), réinstalle les dépendances si
 *                        elles ont changé, reconstruit dist/ ; mode zip : télécharge le dernier zip construit par
 *                        GitHub et le décompresse dans le dossier de l'extension.
 *
 * La configuration (mode, dossiers) est écrite par install.mjs dans ~/.wiky-traders/config.json.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const REPO = 'AndyB31/Wiky-Traders';
const ZIP_URL = `https://github.com/${REPO}/releases/download/latest/wiky-traders.zip`;
const CONFIG = process.env.WIKY_UPDATER_CONFIG || join(homedir(), '.wiky-traders', 'config.json');

function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => {
      chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length >= 4 + len) resolve(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')));
      }
    });
    process.stdin.on('end', () => reject(new Error('message incomplet')));
  });
}

function send(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

const log = [];
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, env: process.env, maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      const out = `${stdout}${stderr}`.trim();
      if (out) log.push(`$ ${cmd} ${args.join(' ')}`, ...out.split('\n').slice(-15));
      if (err) reject(new Error(`${cmd} ${args.join(' ')} : ${(stderr || err.message).trim().split('\n').slice(-3).join(' ')}`));
      else resolve(out);
    });
  });
}

function config() {
  if (!existsSync(CONFIG)) throw new Error(`configuration absente (${CONFIG}) : lance l'installation du programme d'aide`);
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}

function installedBuild(cfg) {
  const file = cfg.mode === 'git' ? join(cfg.dir, 'dist', 'build.json') : join(cfg.dir, 'build.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const npm = process.platform === 'win32' ? 'npm.cmd' : join(dirname(process.execPath), 'npm');
const npmCmd = existsSync(npm) ? npm : 'npm';

async function updateGit(cfg) {
  const dir = cfg.dir;
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  if (branch !== 'main') throw new Error(`le dépôt est sur la branche « ${branch} » : passe sur main pour mettre à jour`);
  const before = await run('git', ['rev-parse', 'HEAD'], dir);
  await run('git', ['pull', '--ff-only', '--autostash', 'origin', 'main'], dir);
  const after = await run('git', ['rev-parse', 'HEAD'], dir);
  if (before !== after) {
    const changed = await run('git', ['diff', '--name-only', before, after, '--', 'package.json', 'package-lock.json'], dir);
    if (changed) await run(npmCmd, ['install', '--no-audit', '--no-fund'], dir);
  }
  await run(npmCmd, ['run', 'build'], dir);
  return { from: before, to: after };
}

async function updateZip(cfg) {
  const before = installedBuild(cfg)?.sha ?? null;
  const res = await fetch(ZIP_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`téléchargement impossible (${res.status}) : ${ZIP_URL}`);
  const file = join(mkdtempSync(join(tmpdir(), 'wiky-')), 'wiky-traders.zip');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  // bsdtar (macOS, Windows 10+) lit les zip ; sous Linux, unzip.
  if (process.platform === 'linux') await run('unzip', ['-o', '-q', file, '-d', cfg.dir], cfg.dir);
  else await run('tar', ['-xf', file, '-C', cfg.dir], cfg.dir);
  return { from: before, to: installedBuild(cfg)?.sha ?? null };
}

async function main() {
  let msg;
  try {
    msg = await readMessage();
  } catch (e) {
    return send({ ok: false, error: e.message });
  }
  try {
    const cfg = config();
    if (msg?.cmd === 'ping') return send({ ok: true, helper: 1, mode: cfg.mode, dir: cfg.dir, build: installedBuild(cfg) });
    if (msg?.cmd === 'update') {
      const r = cfg.mode === 'git' ? await updateGit(cfg) : await updateZip(cfg);
      return send({ ok: true, ...r, build: installedBuild(cfg), log: log.slice(-40) });
    }
    send({ ok: false, error: `commande inconnue : ${msg?.cmd}` });
  } catch (e) {
    send({ ok: false, error: e.message, log: log.slice(-40) });
  }
}

void main();
