// Keep render motion continuous between fixed simulation ticks. The camera and
// car share this pose; neither follows a different point on the physics clock.
const linear = ['x', 'y', 'z', 'speed', 'steer', 'impact', 'groundY', 'transform', 'time', 'waterDepth'];
const angular = ['heading', 'pitch', 'roll'];
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function createVehiclePresentation(vehicle, supportAt = null) {
  const previous = {}, current = {}, pose = {};
  function copy(target, source) {
    for (const key of linear) target[key] = source[key];
    for (const key of angular) target[key] = source[key];
    target.grounded = source.grounded;
  }
  function reset(next) {
    copy(current, next); copy(previous, next);
    previous.wheelAngle = current.wheelAngle = 0;
    sample(1);
  }
  function advance(next, dt) {
    copy(previous, current); previous.wheelAngle = current.wheelAngle;
    copy(current, next); current.wheelAngle += next.speed * dt / .57 * (1 - next.transform);
  }
  function sample(alpha) {
    alpha = Math.min(1, Math.max(0, alpha));
    for (const key of linear) pose[key] = previous[key] + (current[key] - previous[key]) * alpha;
    // Landing normalizes full barrel turns. Take the short arc across that
    // equivalent-angle boundary instead of briefly spinning backwards.
    for (const key of angular) pose[key] = previous[key] + angleDelta(previous[key], current[key]) * alpha;
    // A straight chord between two supported physics positions can cut through
    // a terrain crest, or hover over a valley. Match support at the displayed
    // position while retaining clearance; never project jumps or boats to land.
    if (supportAt && previous.grounded && current.grounded && previous.transform === 0 && current.transform === 0) {
      const clearance = pose.y - pose.groundY;
      pose.groundY = supportAt(pose.x, pose.z, pose.heading);
      pose.y = pose.groundY + clearance;
    }
    pose.wheelAngle = previous.wheelAngle + (current.wheelAngle - previous.wheelAngle) * alpha;
    return pose;
  }
  reset(vehicle);
  return { advance, reset, sample, pose };
}
