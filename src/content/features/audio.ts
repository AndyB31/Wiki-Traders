/**
 * Sons courts générés (WebAudio, aucun fichier) : carillon de notification et bip d'urgence des mises.
 * Le navigateur n'autorise le son qu'après un geste de l'utilisateur : le contexte audio est créé
 * (ou repris) au premier clic / touche, puis réutilisé. Avant cela, les sons sont simplement ignorés.
 */
let ctx: AudioContext | null = null;
let unlockInstalled = false;

function unlock(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    // Audio indisponible : pas de son.
  }
}

/** Installe le déverrouillage du son au premier geste de l'utilisateur (une fois). */
export function enableAudio(): void {
  if (unlockInstalled) return;
  unlockInstalled = true;
  for (const type of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(type, unlock, true);
}

export function audioReady(): boolean {
  return ctx?.state === 'running';
}

function tones(notes: { f: number; at: number; d: number }[], type: OscillatorType, volume: number): boolean {
  if (!ctx || ctx.state !== 'running') return false;
  try {
    const t0 = ctx.currentTime;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(n.f, t0 + n.at);
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + n.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.d);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.d + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** Carillon doux à deux notes (nouvelle notification). */
export function chime(): boolean {
  return tones([{ f: 660, at: 0, d: 0.075 }, { f: 880, at: 0.09, d: 0.1 }], 'sine', 0.055);
}

/** Trois bips rapides (mise surenchérie qui se termine). */
export function urgentBeep(): boolean {
  return tones([{ f: 880, at: 0, d: 0.12 }, { f: 880, at: 0.16, d: 0.12 }, { f: 1175, at: 0.32, d: 0.12 }], 'square', 0.08);
}
