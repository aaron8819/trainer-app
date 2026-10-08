import { expect, it } from 'vitest';
import aliases from './catalog-search-aliases.json';
import { browseCatalog, catalog, catalogExercise, library, matchesCatalogSearch } from './catalog';
import { canonicalJson } from '../../trainer2-contracts/canonical-json';

it.each(Object.entries(aliases))('%s aliases reach Builder and Swap without changing snapshots',
  (id, queries) => {
    const entry = catalog.find(candidate => candidate.id === id);
    const row = library.find(candidate => candidate.catalogId === id);
    expect(entry, 'Alias must reference a selectable stable identity').toBeDefined();
    expect(row?.selectable).toBe(true);
    if (!entry || !row) throw new Error('Missing alias owner');
    const before = canonicalJson(catalogExercise(entry));
    for (const query of queries) {
      expect(browseCatalog(query, []).map(candidate => candidate.id)).toContain(id);
      expect(matchesCatalogSearch(row, query)).toBe(true);
      expect(matchesCatalogSearch(row, query.toUpperCase())).toBe(true);
    }
    expect(canonicalJson(catalogExercise(entry))).toBe(before);
  });

it('keeps explicit stack and per-arm searches distinct and preserves equipment filtering', () => {
  expect(browseCatalog('machine high row stack', []).map(entry => entry.id))
    .toEqual(['t2:chest-supported-machine-high-row-stack']);
  expect(browseCatalog('machine high row plates per arm', []).map(entry => entry.id))
    .toEqual(['t2:chest-supported-machine-high-row-plates-per-arm']);
  expect(browseCatalog('incline DB bench', ['Barbell'])).toEqual([]);
  expect(browseCatalog('incline DB bench', ['Dumbbell', 'Bench']).map(entry => entry.id))
    .toContain('t2:incline-dumbbell-bench-press');
});

it('does not grant name-only objects another identity’s aliases', () => {
  expect(matchesCatalogSearch({ name: 'Custom exercise', aliases: [] }, 'BB RDL')).toBe(false);
  expect(library.filter(row => !row.selectable)).toHaveLength(59);
  expect(catalog).toHaveLength(104);
});
