// Background music: four tracks streamed from assets/music (never decoded
// whole, so a phone holds a few seconds of audio, not minutes), crossfading
// from one to the next. Two <audio> decks take turns; each feeds the Web Audio
// graph, so the music shares the game's master volume, mute and limiter.

// Each track's level brings it to about -16 LUFS (they were measured at -14.1
// to -15.6), and `end` is where its music stops (a second or two of silence
// follows), so the next one fades in over the closing bars rather than after
// a gap. `mood` steers which plays next.
export const TRACKS = [
  { id: 'golden-hour-highway', title: 'Golden Hour Highway', level: -.7, end: 167.7, mood: 'day' },
  { id: 'chrome-highway', title: 'Chrome Highway', level: -1.2, end: 173.3, mood: 'day' },
  { id: 'night-drive', title: 'Night Drive', level: -1.9, end: 173.1, mood: 'night' },
  { id: 'redline', title: 'Redline', level: -.4, end: 175.1, mood: 'fast' },
];
export const CROSSFADE = 4; // seconds
const dB = value => 10 ** (value / 20);

// A volume slider (0–1) as a gain: squared, so the low half of the slider is
// as useful as the top half (loudness follows the logarithm of gain).
export const volumeGain = volume => Math.max(0, Math.min(1, volume)) ** 2;

// The next track: never the one just played; Night Drive mostly after dark,
// Redline more often in the Roadster, the daytime drives by day.
export function pickTrack(previous, { night = 0, roadster = false } = {}, random = Math.random) {
  const choices = TRACKS.filter(track => track.id !== previous);
  const weight = track => track.mood === 'night' ? .25 + 4 * night : track.mood === 'fast' ? (roadster ? 2.5 : .8) : 1.2 - .7 * night;
  let roll = random() * choices.reduce((sum, track) => sum + weight(track), 0);
  for (const track of choices) if ((roll -= weight(track)) <= 0) return track;
  return choices.at(-1);
}

// output: the node the music feeds (the game's master, before the limiter).
// mood(): { night, roadster } for choosing tracks. base: the music's level
// under the effects at full volume.
export function createMusic(context, output, { base = 1, mood = () => ({}), url = id => `assets/music/${id}.m4a` } = {}) {
  const now = () => context.currentTime;
  // The bus: volume, a short duck under crashes, a gentle dip in the low
  // mids (where the engine and road sit) so they cut through, a high-pass
  // under the rumble, and a low-pass that muffles it in the menu.
  const volume = context.createGain(), duck = context.createGain(), menu = context.createGain(), muffle = context.createBiquadFilter(), mids = context.createBiquadFilter(), rumble = context.createBiquadFilter();
  volume.gain.value = 0;
  mids.type = 'peaking'; mids.frequency.value = 380; mids.Q.value = .8; mids.gain.value = -3;
  rumble.type = 'highpass'; rumble.frequency.value = 35;
  muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = .5;
  rumble.connect(mids).connect(muffle).connect(menu).connect(duck).connect(volume).connect(output);
  const decks = [0, 1].map(() => {
    const element = new Audio(); element.crossOrigin = 'anonymous'; element.preload = 'none';
    const gain = context.createGain(); gain.gain.value = 0;
    context.createMediaElementSource(element).connect(gain).connect(rumble);
    return { element, gain, track: null };
  });
  let active = 0, level = 0, playing = false, fading = false, started = 0;

  function load(deck, track) {
    deck.track = track;
    deck.element.src = url(track.id); deck.element.preload = 'auto';
  }
  // Start a track on the idle deck and fade it in, fading the other out.
  function play(track, fade = CROSSFADE) {
    const from = decks[active], to = decks[1 - active];
    if (to.track !== track) load(to, track);
    to.element.currentTime = 0;
    to.element.play().catch(() => {});
    const t = now();
    to.gain.gain.cancelScheduledValues(t); to.gain.gain.setValueAtTime(0, t); to.gain.gain.linearRampToValueAtTime(dB(track.level), t + fade);
    from.gain.gain.cancelScheduledValues(t); from.gain.gain.setValueAtTime(from.gain.gain.value, t); from.gain.gain.linearRampToValueAtTime(0, t + fade);
    const leaving = from.element;
    setTimeout(() => { if (decks[active].element !== leaving) leaving.pause(); fading = false; }, fade * 1000 + 100);
    active = 1 - active; fading = true; started++;
  }
  // As a track reaches its closing bars, the next one fades in over them.
  for (const deck of decks) {
    deck.element.addEventListener('timeupdate', () => {
      if (!playing || fading || deck !== decks[active] || !deck.track) return;
      if (deck.element.currentTime >= deck.track.end - CROSSFADE) play(pickTrack(deck.track.id, mood()));
    });
    deck.element.addEventListener('ended', () => { if (playing && deck === decks[active]) play(pickTrack(deck.track?.id, mood()), 1); });
  }

  return {
    // Begin (within a click or tap: browsers only let media start then).
    // The other deck is started and stopped at once with the track likely to
    // come next, which lets it play later on phones that ask for a tap per
    // player (and loads it ahead).
    start() {
      if (playing) return;
      playing = true;
      const deck = decks[active];
      if (deck.track) { deck.element.play().catch(() => {}); return; }
      const first = pickTrack(null, mood()), spare = decks[active];
      load(spare, pickTrack(first.id, mood()));
      spare.element.play().then(() => { if (spare !== decks[active]) spare.element.pause(); }).catch(() => {});
      play(first, 1.5);
    },
    // Stop where it is (the page is hidden); start() carries on from there.
    stop() { playing = false; for (const deck of decks) deck.element.pause(); },
    next() { if (playing) play(pickTrack(decks[active].track?.id, mood()), 1.5); },
    // 0–1 from the volume slider.
    setVolume(value) { level = volumeGain(value) * base; volume.gain.setTargetAtTime(level, now(), .05); },
    // Muffled and quieter behind the menu; clear while driving.
    setMenu(on) {
      muffle.frequency.setTargetAtTime(on ? 1100 : 20000, now(), .25);
      menu.gain.setTargetAtTime(on ? dB(-7) : 1, now(), .25);
    },
    // A short dip under a crash or a big splash (amount 0–1, up to -6 dB).
    dip(amount) {
      const t = now(), floor = dB(-6 * Math.min(1, amount));
      if (floor >= duck.gain.value) return;
      duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(duck.gain.value, t);
      duck.gain.linearRampToValueAtTime(floor, t + .03); duck.gain.setTargetAtTime(1, t + .15, .5);
    },
    get track() { return decks[active].track; },
    get playing() { return playing && !decks[active].element.paused; },
    get level() { return level; },
    get started() { return started; },
    get time() { return decks[active].element.currentTime; },
  };
}
