export const CYCLE_BOOST_SPEED = 500 / 3.6;
export const CYCLE_LEAN = .6, CYCLE_CARVE = .35; // radians at full lean; how much of the turn a full lean adds or takes
const TURN_LEAN = .48; // radians the bike leans by itself at full steering
export const CYCLE_MAX_LEAN = .75; // both together
export const CYCLE_WATER_GAP = .08; // metres: how far above the water the tyres run
export function cycleState() { return { wheelRadius: .604, wheelie: 0, lean: 0, turnLean: 0, neonCharge: 1, neonBoost: false, neonForced: false, boostHeld: false, overWater: false, skimming: false }; }
// A lean with Q / E into the turn tightens it; against it, widens it. On its own it doesn't turn the bike.
export const cycleCarve = car => 1 + Math.sign(car.steer) * car.lean / CYCLE_LEAN * CYCLE_CARVE;
export function stepCycle(car, input, dt) {
  if ((car.neonRequested || input.boost && !car.boostHeld) && car.neonCharge >= .25) { car.neonBoost = true; car.neonForced = false; }
  car.neonRequested = false;
  car.boostHeld = !!input.boost;
  // Water fires the boost, however little is left, and holds it until the shore.
  if (car.skimming && !car.neonBoost) { car.neonBoost = true; car.neonForced = true; }
  if (car.neonForced && !car.skimming) { car.neonBoost = false; car.neonForced = false; }
  if (car.neonBoost) {
    car.neonCharge = Math.max(0, car.neonCharge - dt / 4);
    if (car.neonCharge <= 1e-6) { car.neonCharge = 0; if (!car.skimming) car.neonBoost = false; }
  } else car.neonCharge = Math.min(1, car.neonCharge + dt / 8);
  const target = car.grounded && input.wheelieUp && !input.wheelieDown ? .68 : 0;
  car.wheelie += (target - car.wheelie) * (1 - Math.exp(-dt * (input.wheelieDown ? 7 : 4)));
  // It leans into turns by itself; Q / E (+ is left, like steer) lean it further. Only on the ground.
  const ease = 1 - Math.exp(-dt * 9), moving = Math.min(Math.abs(car.speed) / 18, 1);
  const lean = car.grounded ? (input.leanLeft ? 1 : 0) - (input.leanRight ? 1 : 0) : 0;
  car.lean += (lean * CYCLE_LEAN * (.3 + .7 * moving) - car.lean) * ease;
  car.turnLean += ((car.grounded ? car.steer * TURN_LEAN * moving : 0) - car.turnLean) * ease;
}
// The world as the bike's tyres see it: water is a surface to run on. Cached per
// world, so the view is made once. Away from water it's the land as it is.
const views = new WeakMap();
export function skimWorld(world) {
  let view = views.get(world);
  if (!view) {
    const surface = (x, z, y) => {
      const ground = world.surface(x, z, y), water = world.waterAt?.(x, z);
      return water ? Math.max(ground, water.level + CYCLE_WATER_GAP) : ground;
    };
    const gradient = (x, z) => world.waterAt?.(x, z) ? { x: (surface(x + 2, z) - surface(x - 2, z)) / 4, z: (surface(x, z + 2) - surface(x, z - 2)) / 4 } : world.gradient(x, z);
    view = Object.assign(Object.create(world), { surface, gradient });
    views.set(world, view);
  }
  return view;
}
