export const LOAD_STEP_LB = 2.5;
const LOAD_TOLERANCE = 1e-9;

export function toLoadSteps(load: number): number {
  return Math.round(load / LOAD_STEP_LB);
}

export function fromLoadSteps(steps: number): number {
  return steps * LOAD_STEP_LB;
}

export function quantizeLoad(load: number): number {
  return fromLoadSteps(toLoadSteps(load));
}

export function isQuantizedLoad(load: number): boolean {
  const quantized = quantizeLoad(load);
  return Math.abs(load - quantized) < LOAD_TOLERANCE;
}
