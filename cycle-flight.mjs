// The Light Cycle's flight: it leaps off the ground at speed and unfolds in the
// air into a small jet. The front wheel lies flat as the intake, the rear one
// turns aft as the exhaust, swept wings with elevons slide out of the
// shoulders and two canted fins rise at the tail. With both wheels folded away
// it cannot roll, so it has no take-off run and no rolling landing: it changes
// form in the air, and lands by becoming the bike again.
//
// Its own flight model, not the ATLAS's (flight-motion.mjs). The ATLAS's nose
// is steered directly; here the attitude has momentum. Roll, pitch and yaw
// rates are part of the state and the air turns them: the tail's spring toward
// the trimmed angle of attack and its damping, the fins weathervaning into a
// sideslip, the wing's dihedral rolling out of one, the elevons against the
// roll's own damping. The numbers are a jet's: thrust that barely fades with
// speed, a neon afterburner, a thin swept wing that turns hard but bleeds
// speed doing it, and no sharp stall, only more and more drag.
// Deterministic fixed steps, shared by the game and the tests.
import { rotate, attitudeFromEuler, setAttitude, qMul, qAxis, airDensity, airMotion, groundEffect, flightAxes, simpleAxes, climbOutAngle,
  FLIGHT_TRANSFORM_SECONDS, SAFE_ALTITUDE, TAKEOFF_GRACE } from './flight-motion.mjs?v=flight-2';
import { stepCycle, CYCLE_MAX_LEAN } from './cycle-motion.mjs?v=flight-2';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const CYCLE_LAUNCH_SPEED = 50; // m/s, 180 km/h: armed, the bike leaps into the air here
export const CYCLE_STALL_SPEED = 36; // m/s, 130 km/h: level flight is impossible below this
export const CYCLE_AIRSPEED = 111; // m/s, 400 km/h: full throttle in level flight
export const CYCLE_BURNER_AIRSPEED = 139; // m/s, 500 km/h: with the neon afterburner
const LEAP = 10; // m/s upward at the launch: about two seconds of air to unfold in
const GLIDE_SPEED = 30; // from a jump or a ramp it needs at least this to become the jet
// Aerodynamics per unit mass (m/s²), as the ATLAS's are. A thin, swept wing
// of short span: a shallow lift slope up to 24°, no sharp break after it, a
// low drag fast and a high one whenever it is made to lift hard (a 5 g turn
// costs about 7 m/s² of speed, more than the jet can replace). Loads are
// limited to 7 g.
const LIFT = .00512, CL0 = .05, CL_SLOPE = 3.4, STALL_ANGLE = .42, DRAG = .00035, INDUCED = .0008, SEPARATED = .01, SIDE = .004;
const AIR_BRAKE = 4, MAX_LOAD = 68.6, NEVER_EXCEED = 165;
export function cycleLift(alpha) {
  const peak = CL0 + CL_SLOPE * STALL_ANGLE, trough = CL0 - CL_SLOPE * STALL_ANGLE;
  if (alpha > STALL_ANGLE) return Math.max(.4, peak * (1 - (alpha - STALL_ANGLE) * 1.1));
  if (alpha < -STALL_ANGLE) return Math.min(-.4, trough * (1 - (-alpha - STALL_ANGLE) * 1.1));
  return CL0 + CL_SLOPE * alpha;
}
// The jet: about half the craft's weight standing still, nearly as much at
// speed (a propeller's fades far faster), and the neon boost burns as an
// afterburner on top of it. An electric fan spools quickly.
const THRUST = 5.4, BURNER = 3.35, THRUST_FADE = 600, SPOOL_UP = .35, SPOOL_DOWN = .25;
export const jetThrust = (power, burner, speed, rho = 1) => (THRUST * power + BURNER * burner) * rho / (1 + Math.max(0, speed) / THRUST_FADE);
// How the air turns it, as angular accelerations. Each grows with the air's
// pressure on the surfaces (the springs and the controls) or with its speed
// past them (the damping), measured against CONTROL_SPEED: the pitch
// oscillation is about 0.8 Hz there and quicker when faster, always damped at
// about 0.6 of critical, as a real aircraft's is.
const CONTROL_SPEED = 70;
const PITCH_SPRING = 25, PITCH_DAMPING = 6, PITCH_SWING = .34; // full stick moves the wing this far from its trimmed angle
const ALPHA_LIMIT = STALL_ANGLE + .04; // but no further than just past the stall: the elevons run out there
const YAW_SPRING = 9, YAW_DAMPING = 4.2, RUDDER = .15; // the fins hold the nose into the airflow; full rudder skids it this far out of it (about 8°)
const ROLL_DAMPING = 6.7, ROLL_RATE = 3, DIHEDRAL_EFFECT = 11; // elevons: 170°/s; a sideslip rolls it away from the slip
const WINGSPAN = 4.62, WING_HEIGHT = .78;
// The jet's outline for what it can touch (see ATLAS_FRAME): measured from the
// model with its wings out. The wings slide out from the shoulders.
export const CYCLE_FRAME = { pivot: .8, root: .2, span: flight => .2 + 2.11 * smoothstep(0, 1, flight), wing: x => [x, .68 + Math.abs(x) * .09, -.6 - Math.abs(x) * .28],
  points: [{ p: [.66, 1.68, -1.54], tail: true }, { p: [-.66, 1.68, -1.54], tail: true }, { p: [0, .84, -1.97], tail: true }, { p: [0, 1.09, 2.4], nose: true }, { p: [0, 1.78, .1], nose: true }] }; // (the last: the rider's helmet)

// G arms and disarms it. Armed on the ground it stays a bike until it is fast
// enough to leap; in the air, disarming folds it back to land on its wheels.
export function toggleCycleFlight(car) {
  if (car.kind !== 'lightcycle') return false;
  car.flightMode = !car.flightMode;
  return car.flightMode;
}

function spool(car, wanted, dt) {
  const power = car.power || 0;
  return car.power = power + (wanted - power) * (1 - Math.exp(-dt / (wanted > power ? SPOOL_UP : SPOOL_DOWN)));
}

function startFlying(car, vy) {
  const horizontal = Math.hypot(car.vx, car.vz);
  car.vy = vy; car.flying = true; car.grounded = false; car.skimming = false;
  car.airspeed = Math.hypot(horizontal, vy);
  // It leaves the ground as it was riding: leaning into its turn, nose along
  // its path and a little above it.
  const lean = clamp((car.lean || 0) + (car.turnLean || 0), -CYCLE_MAX_LEAN, CYCLE_MAX_LEAN), path = Math.atan2(vy, Math.max(horizontal, 1));
  setAttitude(car, attitudeFromEuler(car.heading, -(path + .1), (car.roll || 0) - lean));
  car.wx = car.wy = car.wz = 0; car.climb = path; car.alpha = 0;
  car.coyote = 0; car.jumpBuffer = 0; car.airtime = 0; car.airDistance = 0; car.rollVelocity = 0; car.airRoll = 0; car.landLock = 0;
  car.assistPath = null; car.climbOut = true; car.takeoff = TAKEOFF_GRACE; car.flights++;
}

// Back on its wheels (or on the water it rides on): the bike's own physics
// take it from here, with whatever speed it arrived at. The wings snap away
// quickly, since it needs its wheels at once.
function land(car, ground) {
  const descent = -car.vy;
  car.flying = false; car.flightMode = false; car.crashFold = true; car.climb = 0; car.climbOut = false; car.takeoff = 0;
  car.y = ground; car.vy = 0; car.airtime = 0; car.airDistance = 0; car.rollVelocity = 0; car.airRoll = 0;
  car.wx = car.wy = car.wz = 0; car.buffet = 0; car.load = 1;
  car.impact = Math.max(car.impact, clamp(descent * .02, 0, .3));
  if (descent > 9) { car.vx *= .55; car.vz *= .55; } // a steep or fast arrival scrubs speed, but it always lands rideable
  car.roll = Math.atan2(Math.sin(car.roll), Math.cos(car.roll));
  car.grounded = true; car.landLock = .1; car.coyote = .1; car.shadow = 0; car.shadowVy = 0; car.landings = (car.landings || 0) + 1;
}

// The ground (or the water, which is ground to the bike) while it is the jet.
// Slower than it can fly, or with the nose eased down onto it, it lands: the
// wings fold and it rides on. Faster, it has no wheels to roll on, so it skips
// off its belly, losing a little speed, and flies on.
function touchdown(car, ground, rise) {
  const descent = -car.vy;
  if (!car.flightMode || car.airspeed < CYCLE_STALL_SPEED + 5 || (descent < 4 && car.pushingDown)) { land(car, ground); return; }
  const hard = descent > 7, uphill = Math.max(0, rise), follow = uphill * Math.hypot(car.vx, car.vz);
  car.impact = Math.max(car.impact, clamp(descent * .02, .05, .3));
  car.y = ground + .05;
  car.vy = Math.max(hard ? Math.min(descent * .3, 6) : car.vy, follow, 0);
  const scrub = hard ? .82 : .97; car.vx *= scrub; car.vz *= scrub;
  // Deflected by the ground: never pointing into it, never upside down, and no longer turning.
  const q = [car.qx, car.qy, car.qz, car.qw], nose = rotate(q, [0, 0, 1]), mast = rotate(q, [0, 1, 0]);
  if (nose[1] < Math.sin(Math.atan(uphill)) || mast[1] < 0) setAttitude(car, attitudeFromEuler(Math.atan2(car.vx, car.vz), -.05 - Math.atan(uphill), mast[1] < 0 ? 0 : car.roll));
  car.wx = car.wy = car.wz = 0;
  car.airspeed = Math.hypot(car.vx, car.vy, car.vz); car.climb = Math.asin(clamp(car.vy / (car.airspeed || 1), -1, 1));
}

// Lowest clearance of the wingtips, fins, tail and nose over the ground or
// water (negative when buried). Exported for tests.
export function cycleClearance(car, world) {
  const q = [car.qx, car.qy, car.qz, car.qw], frame = CYCLE_FRAME, span = frame.span(car.flight);
  let lowest = { depth: -Infinity };
  for (const point of [{ p: frame.wing(span), side: 1 }, { p: frame.wing(-span), side: -1 }, ...frame.points]) {
    const r = rotate(q, [point.p[0], point.p[1] - frame.pivot, point.p[2]]);
    const depth = world.surface(car.x + r[0], car.z + r[2]) - (car.y + frame.pivot + r[1]);
    if (depth > lowest.depth) lowest = { depth, point };
  }
  return lowest;
}
// A wingtip, fin or the nose in the ground ends the flight: the wings snap
// shut and it falls the rest of the way as the bike. While it is still
// unfolding after the leap, a touch is shrugged off.
function scrape(car, world) {
  const { depth, point } = cycleClearance(car, world);
  if (!(depth > 0)) return;
  car.y += depth;
  if (car.takeoff > 0) {
    car.vy = Math.max(car.vy, 0); car.impact = Math.max(car.impact, .08);
    const q = [car.qx, car.qy, car.qz, car.qw];
    setAttitude(car, qMul(q, point.side ? qAxis(0, 0, point.side * .05) : qAxis(point.tail ? .04 : -.04, 0, 0)));
    car.wx = car.wy = car.wz = 0;
    return;
  }
  car.flying = false; car.flightMode = false; car.grounded = false; car.crashFold = true; car.climbOut = false;
  car.vx *= .9; car.vz *= .9; car.vy = Math.min(car.vy, 0);
  car.airtime = 0; car.airDistance = 0; car.rollVelocity = 0; car.landLock = 0; car.coyote = 0; car.wx = car.wy = car.wz = 0;
  car.impact = Math.max(car.impact, .3); car.wingCrashes = (car.wingCrashes || 0) + 1;
}

function fly(car, input, world, dt, groundAt) {
  const simple = Boolean(input.simpleFlight);
  if (!simple) car.assistPath = null;
  const below = groundAt(world, car.x, car.z, car.heading, undefined, 'lightcycle');
  // The neon charge is the afterburner's fuel; nothing forces it up here.
  car.skimming = false; stepCycle(car, input, dt);
  const { throttle, pitch: stick, roll, yaw, turn: arcadeTurn = 0 } = simple ? simpleAxes(car, input, dt, below) : flightAxes(input);
  car.pushingDown = (simple ? flightAxes({ ...input, simpleFlight: true }).pitch : stick) < -.25; // the rider, not the simple controls' own trim
  const wings = car.flight, oldX = car.x, oldZ = car.z;
  let q = [car.qx, car.qy, car.qz, car.qw];
  const nose = rotate(q, [0, 0, 1]), mast = rotate(q, [0, 1, 0]), wing = rotate(q, [1, 0, 0]);
  // Its motion through the air (flow), which the wind carries, and over the ground (v).
  const height = car.y - below.y, air = airMotion(world, car.x, car.y, car.z, car.time, height);
  const v = [car.vx, car.vy, car.vz], flow = v.map((c, k) => c - air[k]), speed = Math.hypot(...flow), dir = speed > 1e-3 ? flow.map(c => c / speed) : nose;
  const along = Math.max(dot(flow, nose), 1e-3), alpha = Math.atan2(-dot(flow, mast), along), beta = Math.atan2(dot(flow, wing), along);
  const rho = airDensity(car.y), pressure = rho * speed * speed;
  // Low and wide for its span, the wing feels the ground strongly.
  const cushion = groundEffect(height, WING_HEIGHT, WINGSPAN) * wings;
  const cl = cycleLift(alpha) * wings * (1 + .12 * cushion); // folded wings give no lift
  // A swept wing never lets go all at once. Past 24° its lift sags, the drag
  // climbs steeply and the airframe shakes; the elevons and fins lose bite.
  const stalled = smoothstep(STALL_ANGLE, STALL_ANGLE + .12, Math.abs(alpha)) * wings * smoothstep(8, 18, speed);
  const separated = smoothstep(STALL_ANGLE - .06, STALL_ANGLE + .2, Math.abs(alpha)) * Math.sin(alpha) ** 2 * wings;
  car.buffet = smoothstep(STALL_ANGLE - .09, STALL_ANGLE + .05, Math.abs(alpha)) * wings * smoothstep(15, 30, speed);
  const across = mast.map((c, k) => c - dir[k] * dot(mast, dir)), length = Math.hypot(...across) || 1;
  const lift = clamp(LIFT * pressure * cl, -MAX_LOAD, MAX_LOAD);
  car.load = lift / 9.8;
  // Thrust while W is held, or while the afterburner burns; S opens the air
  // brakes. The jet needs the wheels in place as its intake and exhaust: folded
  // (or folding), it has neither thrust nor brakes.
  const stowed = car.flightMode ? 1 : wings, burning = car.neonBoost ? 1 : 0;
  const power = spool(car, clamp(Math.max(throttle, burning), 0, 1) * stowed, dt);
  const thrust = jetThrust(power, burning * stowed, along, rho) * (.3 + .7 * wings);
  const drag = (DRAG * (1 + AIR_BRAKE * Math.max(0, -throttle * stowed)) + INDUCED * cl * cl * (1 - .6 * cushion) + SEPARATED * separated) * pressure, slip = SIDE * pressure * beta;
  for (let k = 0; k < 3; k++) v[k] += (nose[k] * thrust + across[k] / length * lift - dir[k] * drag - wing[k] * slip + (k === 1 ? -9.8 : 0)) * dt;
  // How fast the forces are swinging the flight path round, about the wing and
  // the mast: the damping below works on the turning relative to it, so a
  // steady turn or pull holds its angles exactly.
  const turning = [0, 1, 2].map(k => nose[k] * thrust + across[k] / length * lift - wing[k] * slip + (k === 1 ? -9.8 : 0));
  const sweep = [dir[1] * turning[2] - dir[2] * turning[1], dir[2] * turning[0] - dir[0] * turning[2], dir[0] * turning[1] - dir[1] * turning[0]].map(c => c / Math.max(speed, 8));
  const pathX = dot(sweep, wing), pathY = dot(sweep, mast);
  const fast = Math.hypot(...v); if (fast > NEVER_EXCEED) for (let k = 0; k < 3; k++) v[k] *= NEVER_EXCEED / fast;

  // The air on the surfaces: its pressure works the springs and the controls,
  // its speed the damping. Both go as the wings fold.
  const surfaces = (.3 + .7 * wings) * stowed, press = pressure / (CONTROL_SPEED * CONTROL_SPEED) * surfaces, wash = rho * speed / CONTROL_SPEED * surfaces;
  const bank = Math.atan2(wing[1], mast[1]), pathAngle = Math.asin(clamp(dir[1], -1, 1)); // bank: 0 level, + right wing down
  // Pitch. The tail trims the wing to the angle at which lift carries the
  // weight on this flight path (and in this bank, when upright): hands off,
  // it holds its path. The stick moves the wing from there.
  let pull = simple ? stick * .5 : stick; // the simple controls fly it gently: half the stick, about 3 g
  if (!simple) {
    // Hands off after the leap, it climbs out to a safe height and levels.
    if (stick || mast[1] < .5) car.climbOut = false;
    else if (car.climbOut && height < SAFE_ALTITUDE) pull = clamp((climbOutAngle(car, below) - pathAngle) * 3, -.2, 1);
    else if (car.climbOut && height < SAFE_ALTITUDE * 2) { pull = clamp(-pathAngle * 2, -1, 1); if (Math.abs(pathAngle) < .02) car.climbOut = false; }
    else car.climbOut = false;
  }
  // (The jet's own push helps carry it when the nose is above the path.)
  const upright = Math.cos(bank) > 0, needed = 9.8 * Math.cos(pathAngle) / (upright ? Math.max(Math.cos(bank), .5) : 1) - (upright ? thrust * Math.sin(alpha) : 0);
  const trim = clamp((needed / Math.max(LIFT * pressure * wings, 1e-3) - CL0) / CL_SLOPE, -.12, STALL_ANGLE - .06);
  const pitchUp = PITCH_SPRING * press * (clamp(trim + pull * PITCH_SWING, -ALPHA_LIMIT, ALPHA_LIMIT) - alpha);
  // Yaw. The fins swing the nose into a sideslip (less when stalled, in the
  // wing's wake); the rudder holds it a few degrees out of it.
  const yawLeft = YAW_SPRING * press * (beta * (1 - .5 * stalled) + yaw * RUDDER);
  // Roll. The elevons against the roll's own damping; a sideslip lifts the
  // wing it comes from. Folded, the body drifts upright slowly, as the bike does in the air.
  const wanted = -roll * ROLL_RATE * clamp(speed / 60, 0, 1) * (1 - .5 * stalled);
  const rollRight = ROLL_DAMPING * wash * wanted + DIHEDRAL_EFFECT * press * beta + (car.flightMode ? 0 : -bank * 2 * (1 - wings));
  // Each rate gains its moment and loses to its damping (taken implicitly, so
  // no speed makes the step unstable). + wx lowers the nose, + wy swings it left, + wz drops the right wing.
  const still = 1.2 * (1 - surfaces); // out of the airflow, a tumble still dies away
  const pitchHold = PITCH_DAMPING * wash, yawHold = YAW_DAMPING * wash;
  car.wx = ((car.wx || 0) - pitchUp * dt + pitchHold * dt * pathX) / (1 + (pitchHold + still) * dt);
  car.wy = ((car.wy || 0) + yawLeft * dt + yawHold * dt * pathY) / (1 + (yawHold + still) * dt);
  car.wz = ((car.wz || 0) + rollRight * dt) / (1 + (ROLL_DAMPING * wash * (1 - .4 * stalled) + still) * dt);
  q = qMul(q, qAxis(car.wx * dt, car.wy * dt, car.wz * dt));
  // The simple controls also swing the flight path round directly, as the ATLAS's do.
  if (arcadeTurn) {
    const swing = arcadeTurn * .5 * clamp(press, 0, 1) * dt, c = Math.cos(swing), sn = Math.sin(swing), fx = v[0] - air[0], fz = v[2] - air[2];
    [v[0], v[2]] = [air[0] + fx * c + fz * sn, air[2] - fx * sn + fz * c];
    q = qMul(qAxis(0, swing, 0), q);
  }
  setAttitude(car, q);
  [car.vx, car.vy, car.vz] = v;
  car.x += v[0] * dt; car.y += v[1] * dt; car.z += v[2] * dt;
  car.airspeed = Math.hypot(v[0] - air[0], v[1] - air[1], v[2] - air[2]); car.speed = Math.hypot(v[0], v[2]); car.alpha = alpha;
  car.climb = Math.asin(clamp(v[1] / (Math.hypot(...v) || 1), -1, 1));
  car.steer += (0 - car.steer) * (1 - Math.exp(-8 * dt)); car.time += dt;
  const travelled = Math.hypot(car.x - oldX, car.z - oldZ);
  car.distance += travelled; car.flightDistance += travelled; car.airtime += dt;
  car.takeoff = Math.max(0, (car.takeoff || 0) - dt);
  const water = world.waterAt?.(car.x, car.z), g = groundAt(world, car.x, car.z, car.heading, undefined, 'lightcycle');
  car.groundY = g.y; car.waterDepth = water?.depth ?? 0; car.waterLevel = water?.level ?? null; car.overWater = Boolean(water) && water.level > g.y - 1;
  car.onRoad = car.onDirt = false;
  car.maxAltitude = Math.max(car.maxAltitude, car.y - g.y);
  // Upside down, the fins and the rider meet the ground before the belly can.
  if (car.y <= g.y && rotate([car.qx, car.qy, car.qz, car.qw], [0, 1, 0])[1] > 0) {
    const slope = water ? null : world.gradient?.(car.x, car.z), over = Math.hypot(car.vx, car.vz) || 1;
    touchdown(car, g.y, slope ? (slope.x * car.vx + slope.z * car.vz) / over : 0);
  } else scrape(car, world);
  return true;
}

// Returns true when it moved the bike this tick; otherwise the bike's own
// physics run as usual. world: the bike's view of it (skimWorld), in which
// water is a surface to ride on.
export function stepCycleFlight(car, input, world, dt, groundAt) {
  // The wings only come out in the air: on the ground the wheels are wheels.
  car.flight = clamp(car.flight + (car.flying && car.flightMode ? dt : -dt * (car.crashFold ? 3.5 : 1)) / FLIGHT_TRANSFORM_SECONDS, 0, 1);
  if (car.flight === 0) car.crashFold = false;
  if (!car.flying) {
    car.buffet = 0; car.load = 1; spool(car, 0, dt);
    if (!car.flightMode) return false;
    const horizontal = Math.hypot(car.vx, car.vz), forward = car.vx * Math.sin(car.heading) + car.vz * Math.cos(car.heading);
    if (car.grounded) {
      // Armed and fast enough: it leaps, carrying the rise of the ground it leaves.
      if (forward < CYCLE_LAUNCH_SPEED) return false;
      const ground = groundAt(world, car.x, car.z, car.heading, undefined, 'lightcycle');
      startFlying(car, LEAP + Math.max(0, -Math.tan(ground.pitch) * horizontal));
    } else {
      // Armed in the air, off a jump or a ramp: once it is well clear and fast enough to glide.
      const clear = car.y - groundAt(world, car.x, car.z, car.heading, undefined, 'lightcycle').y > 1.2 || car.airtime > .45;
      if (!clear || horizontal < GLIDE_SPEED) return false;
      startFlying(car, car.vy);
    }
  }
  car.impact *= Math.exp(-8 * dt);
  return fly(car, input, world, dt, groundAt);
}
