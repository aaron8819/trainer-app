export const LOAD_STEP_LB = 2.5;
const LOAD_TOLERANCE = 1e-9;

export function toLoadSteps(load: number, step = LOAD_STEP_LB): number {
  return Math.round(load / step);
}

export function fromLoadSteps(steps: number, step = LOAD_STEP_LB): number {
  return steps * step;
}

export function quantizeLoad(load: number, step = LOAD_STEP_LB): number {
  const validStep = Number.isFinite(step) && step > 0 ? step : LOAD_STEP_LB;
  return fromLoadSteps(toLoadSteps(load, validStep), validStep);
}

export function isQuantizedLoad(load: number, step = LOAD_STEP_LB): boolean {
  const quantized = quantizeLoad(load, step);
  return Math.abs(load - quantized) < LOAD_TOLERANCE;
}
