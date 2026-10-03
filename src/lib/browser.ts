/** API d'extension : `browser` sous Firefox, `chrome` ailleurs (les deux renvoient des promesses en MV3). */
export const ext: typeof chrome = (globalThis as unknown as { browser?: typeof chrome }).browser ?? globalThis.chrome;
