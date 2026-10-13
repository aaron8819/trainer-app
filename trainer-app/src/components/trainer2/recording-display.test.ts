import { describe, expect, it } from 'vitest';
import { catalog } from '@/lib/engine/trainer2/catalog';
import {
  orderRecordingVariants, recordingSubtitle, recordingTip, unavailableRecordingCopy,
} from './recording-display';
import { swapOptions } from './swap-options';

const entry = (key: string) => catalog.find(e => e.id === `t2:${key}`)!;
const single = 'single-arm-iso-lateral-low-row';
const both = 'bilateral-iso-lateral-low-row-total-plates';

describe('recording choices preserve distinct identities', () => {
  it('distinguishes visually identical high-row titles by their reviewed tuple', () => {
    expect(recordingSubtitle(entry('chest-supported-machine-high-row-stack')))
      .toBe('Stack setting · Total reps');
    expect(recordingSubtitle(entry('chest-supported-machine-high-row-plates-per-arm')))
      .toBe('Plates per arm · Total reps');
    expect(recordingSubtitle(entry('single-arm-iso-lateral-high-row')))
      .toBe('Plates per arm · Reps per arm');
    expect(recordingSubtitle(entry('bilateral-iso-lateral-high-row-total-plates')))
      .toBe('Combined plates · Total reps');
  });
  it('keeps side-based leg movements and non-iso-lateral total plate tips unchanged', () => {
    expect(recordingSubtitle(entry('smith-machine-bulgarian-split-squat-plates-added')))
      .toContain('Reps per side');
    expect(recordingTip(entry('plate-loaded-glute-bridge-trainer'))).toBeUndefined();
    expect(recordingTip(entry(single))).toContain('enter 45 lb');
    expect(recordingTip(entry(both))).toContain('enter 90 lb');
  });
  it('groups only existing iso-lateral results without inventing or losing matches', () => {
    const input = [entry(both), entry('leg-press'), entry(single)];
    const before = JSON.stringify(input);
    expect(orderRecordingVariants(input).map(e => e.id))
      .toEqual([entry(single).id, entry('leg-press').id, entry(both).id]);
    expect(JSON.stringify(input)).toBe(before);
    expect(orderRecordingVariants([entry(both)])).toEqual([entry(both)]);
  });
  it('keeps diagnostic field names out of unavailable UI copy', () => {
    expect(unavailableRecordingCopy('Reviewed measurement definition missing: repBasis.'))
      .toBe('Not available for logging yet. Choose a reviewed variant from the results above.');
    expect(unavailableRecordingCopy('Duration or distance recording is not supported.'))
      .toBe('Timed and distance logging is not available.');
  });
});

describe('bounded swap ordering', () => {
  it('omits effective current identity and places reviewed low-row alternatives first', () => {
    const choices = swapOptions(entry(both).id, '', '');
    expect(choices.some(e => e.catalogId === entry(both).id)).toBe(false);
    expect(choices[0].catalogId).toBe(entry(single).id);
    const firstUnavailable = choices.findIndex(e => !e.selectable);
    expect(choices.slice(firstUnavailable).every(e => !e.selectable)).toBe(true);
  });
  it.each(['low-row', 'front-lat-pulldown', 'high-row'])(
    'prefers single arm within the current %s family', movement => {
      const choices = swapOptions(entry(`bilateral-iso-lateral-${movement}-total-plates`).id,
        movement.replaceAll('-', ' '), '');
      expect(choices[0].catalogId).toBe(`t2:single-arm-iso-lateral-${movement}`);
    },
  );
  it('honors explicit both-arms search and equipment filters', () => {
    const choices = swapOptions(entry(single).id, 'both arms', 'Machine');
    expect(choices.length).toBeGreaterThan(0);
    expect(choices.every(e => e.name.includes('(Both Arms)'))).toBe(true);
    expect(swapOptions(entry(single).id, 'both arms', 'Barbell')).toEqual([]);
  });
  it('preserves movement relevance outside the three machine families', () => {
    const choices = swapOptions(entry('leg-press').id, '', '');
    expect(choices[0].movementPatterns).toContain('squat');
  });
});
