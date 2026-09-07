// Keep render motion continuous between fixed simulation ticks. The camera and
// car share this pose; neither follows a different point on the physics clock.
const linear = ['x', 'y', 'z', 'speed', 'steer', 'impact', 'groundY'];
const angular = ['heading', 'pitch', 'roll'];
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function createVehiclePresentation(vehicle) {
  const previous = {}, current = {}, pose = {};
  function copy(target, source) {
    for (const key of linear) target[key] = source[key];
    for (const key of angular) target[key] = source[key];
  }
  function reset(next) {
    copy(current, next); copy(previous, next);
    previous.wheelAngle = current.wheelAngle = 0;
    sample(1);
  }
  function advance(next, dt) {
    copy(previous, current); previous.wheelAngle = current.wheelAngle;
    copy(current, next); current.wheelAngle += next.speed * dt / .57;
  }
  function sample(alpha) {
    alpha = Math.min(1, Math.max(0, alpha));
    for (const key of linear) pose[key] = previous[key] + (current[key] - previous[key]) * alpha;
    // Landing normalizes full barrel turns. Take the short arc across that
    // equivalent-angle boundary instead of briefly spinning backwards.
    for (const key of angular) pose[key] = previous[key] + angleDelta(previous[key], current[key]) * alpha;
    pose.wheelAngle = previous.wheelAngle + (current.wheelAngle - previous.wheelAngle) * alpha;
    return pose;
  }
  reset(vehicle);
  return { advance, reset, sample, pose };
}
