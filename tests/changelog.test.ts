import { describe, expect, it } from 'vitest';
import { CHANGELOG, LATEST_CHANGELOG, unseenChangelog } from '../src/lib/changelog';

describe('nouveautés', () => {
  it('entrées de la plus récente à la plus ancienne, identifiants uniques et croissants, contenu rempli', () => {
    expect(LATEST_CHANGELOG).toBe(CHANGELOG[0].id);
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i - 1].id > CHANGELOG[i].id).toBe(true);
    for (const e of CHANGELOG) {
      expect(e.id).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]?$/);
      expect(e.title.trim()).not.toBe('');
      expect(e.sections.length).toBeGreaterThan(0);
      for (const s of e.sections) for (const it of s.items) expect(it.title && it.text).toBeTruthy();
    }
  });

  it('seules les entrées plus récentes que la dernière vue sont nouvelles', () => {
    const list = [
      { id: '2026-11-02', title: 'c', sections: [] },
      { id: '2026-10-19b', title: 'b', sections: [] },
      { id: '2026-10-19', title: 'a', sections: [] },
    ];
    expect(unseenChangelog(null, list).map((e) => e.title)).toEqual(['c', 'b', 'a']);
    expect(unseenChangelog('2026-10-19', list).map((e) => e.title)).toEqual(['c', 'b']);
    expect(unseenChangelog('2026-11-02', list)).toEqual([]);
  });
});
