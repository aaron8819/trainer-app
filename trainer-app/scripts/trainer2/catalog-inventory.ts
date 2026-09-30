import shared from '../../prisma/exercises_comprehensive.json';
import before from '../../src/lib/engine/trainer2/qualified-catalog-v1.json';
import { library } from '../../src/lib/engine/trainer2/catalog';

const requiresDurationOrDistance = new Set(['copenhagen-plank', 'dead-hang', 'farmers-walk', 'overhead-carry', 'plank',
  'rkc-plank', 'side-plank', 'sled-drag', 'sled-pull', 'sled-push', 'suitcase-carry']);
const existing = new Set(before.map(e => e.id));
const reviewQuestions: Record<string, string> = {
  'bicycle-crunch': 'Resolve single-side reps versus total alternating reps or paired cycles; publish the reviewed counting convention.',
  'dragon-flag': 'Review dynamic repetitions versus static holds and confirm the movement definition. Qualify a rep variant separately from any hold variant.',
  'dumbbell-row': 'Resolve single-arm versus bilateral execution and the recorded load per implement; split the variants if both are intended.',
  'overhead-dumbbell-extension': 'Resolve one shared dumbbell versus one implement per arm and the rep-count convention; split distinct executions.',
  'nordic-hamstring-curl': 'Separate bodyweight, assisted and added-load executions. Review how any band assistance can be recorded before qualifying it.',
  'walking-lunge': 'Split barbell and dumbbell executions; review total steps versus reps per side and the corresponding load basis.',
  'reverse-lunge': 'Split barbell and dumbbell executions; review total steps versus reps per side and the corresponding load basis.',
  'pallof-press': 'Separate cable and band variants; use the already reviewed cable-pallof-press identity for its qualified execution. Review band-load representation independently.',
  'romanian-deadlift': 'Use the already qualified barbell-romanian-deadlift or dumbbell-romanian-deadlift stable identity for those executions; retain this broad identity as ambiguous.',
  'standing-calf-raise': 'Use the qualified selectorized-standing-calf-raise identity for that execution; review and separate barbell or other machine variants.',
};
function recommend(key: string, equipment: string[]) {
  if (reviewQuestions[key]) return reviewQuestions[key];
  if (['landmine-press', 'landmine-rotation', 'meadows-row'].includes(key))
    return 'Review whether recorded angled-bar load means plates, total assembly or another explicit basis. Qualify only after defining the supported convention and rep basis; do not reuse total-barbell meaning automatically.';
  if (key.startsWith('iso-lateral-'))
    return 'Review independent-arm execution, load per arm versus combined/displayed load and total versus per-side reps. Split differing machine conventions into distinct stable IDs.';
  if (equipment.includes('Machine') && equipment.length === 1)
    return 'Specify the concrete machine configuration, displayed versus added-plate load, rep-count basis and zero capability. Keep differing configurations separate.';
  if (equipment.length > 1)
    return `Review and split the catalog equipment variants (${equipment.join(', ')}); define the load basis and rep counting independently for each executable variant, including unloaded/assisted variants where applicable.`;
  return `Review the ${equipment.join(', ')} execution: specify unilateral/bilateral use, how logged reps count, load per implement versus displayed/combined load, and whether zero is meaningful. Publish that concrete tuple before enabling.`;
}
const rows = library.map(row => {
  const source = shared.exercises.find(e => e.catalogKey === row.catalogKey)!;
  const columns = source as typeof source & { measurementProfile?: string; loadConvention?: string | null; repBasis?: string; zeroLoadMeaning?: string };
  const status = existing.has(row.catalogId) ? 'currentlySupported' : row.selectable ? 'compatibleMissingIntegration' :
    requiresDurationOrDistance.has(row.catalogKey) ? 'requiresNewCapability' : 'missingOrConflictingMetadata';
  const missingFields = row.selectable ? [] : ['measurementProfile', 'loadConvention', 'repBasis'].filter(field => columns[field as keyof typeof columns] == null);
  return { catalogId: row.catalogId, catalogKey: row.catalogKey, name: source.name, status, supportedAfter: row.selectable,
    measurementProfile: columns.measurementProfile ?? null, loadConvention: columns.loadConvention ?? null, repBasis: columns.repBasis ?? null,
    zeroLoadMeaning: columns.zeroLoadMeaning ?? null, equipment: source.equipment, movementPatterns: source.movementPatterns,
    primaryMuscles: source.primaryMuscles, secondaryMuscles: source.secondaryMuscles, prescription: source.repRangeRecommendation,
    normalized: row.entry, missingFields, reason: row.unavailableReason,
    recommendation: row.selectable ? null : status === 'requiresNewCapability' ?
      'Define duration/distance targets and performed evidence, identity/basis, history compatibility and prefill before enabling.' :
      recommend(row.catalogKey, source.equipment) };
});
console.log(JSON.stringify({ source: 'prisma/exercises_comprehensive.json', baselineCommit: '3a2e057d3a205241849827a1f7e7ca580787acaf',
  totals: { canonical: rows.length, before: before.length, after: rows.filter(r => r.supportedAfter).length,
    ...Object.fromEntries(['currentlySupported', 'compatibleMissingIntegration', 'missingOrConflictingMetadata', 'requiresNewCapability'].map(status => [status, rows.filter(r => r.status === status).length])) },
  rows }, null, 2));
