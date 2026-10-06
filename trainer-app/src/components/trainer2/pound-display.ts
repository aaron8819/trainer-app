import type { PerformedResult } from '@/lib/trainer2-contracts/set-results';

// Presentation only. Never write a rounded display value back over an unchanged measurement.
// The international avoirdupois pound is exactly 0.45359237 kg.
export function pounds(value: string, unit: 'kg' | 'lb') {
  if (unit === 'lb') return value;
  const converted = Number(value) / 0.45359237;
  const rounded = Math.round(converted * 100) / 100;
  // A positive supported kg decimal must never display as zero.
  return String(rounded || (converted > 0 ? Math.round(converted * 1e6) / 1e6 : 0));
}
export function loadLabel(m: PerformedResult['measurement'], original = false): string {
  if (!m) return 'load unspecified';
  if (m.kind === 'bodyweight') return 'bodyweight';
  const meaning = m.kind === 'assistance' ? 'assistance' : m.kind === 'addedLoad' ? 'added' :
    m.convention === 'machinePlatesPerArm' ? 'plates added per arm' : m.convention === 'smithPlatesTotal' ? 'total Smith plates added' : m.convention === 'perImplement' ? 'per implement' : m.convention === 'machineDisplayed' ? 'machine displayed' : 'barbell total';
  return `${pounds(m.value, m.unit)} lb ${meaning}${original && m.unit === 'kg' ? ` (recorded ${m.value} kg)` : ''}`;
}
