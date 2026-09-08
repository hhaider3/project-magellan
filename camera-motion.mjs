// Exact exponential follow for a target moving linearly over the frame.
// Lerp-to-the-latest-target changes its lag when frame duration changes.
export function followValue(value, previousTarget, target, rate, dt) {
  if (dt <= 0) return target;
  const decay = Math.exp(-rate * dt), average = -Math.expm1(-rate * dt) / (rate * dt);
  return value * decay + previousTarget * (average - decay) + target * (1 - average);
}

export function followTarget(position, previousTarget, target, rate, dt) {
  for (const key of ['x', 'y', 'z']) {
    position[key] = followValue(position[key], previousTarget[key], target[key], rate, dt);
    previousTarget[key] = target[key];
  }
}
