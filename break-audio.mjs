// Short, locally synthesized effects: no downloads or decode delay on impact.
export function synthesizeBreak(type, sampleRate = 44100) {
  const tree = type === 'tree', cactus = type === 'cactus';
  const duration = tree ? .8 : cactus ? .38 : .6;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const knocks = [0.055, .12, .21, .32];
  let seed = 4919, low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    low += (noise - low) * (cactus ? .055 : tree ? .16 : .45);
    const attack = Math.min(1, t / .002);
    const crack = Math.exp(-t * (tree ? 24 : cactus ? 35 : 45));
    let rattle = 0;
    for (let n = 0; n < knocks.length; n++) if (t >= knocks[n]) rattle += Math.exp(-(t - knocks[n]) * 65) / (n + 2);
    const texture = tree ? low * 1.8 + noise * .25 : cactus ? low * 2.5 : noise - low * .6;
    const tone = Math.sin(2 * Math.PI * (tree ? 135 : cactus ? 85 : type === 'boulder' ? 100 : 280) * t) * Math.exp(-t * 22);
    const tail = Math.min(1, (duration - t) / .035);
    samples[i] = Math.tanh((texture * (crack + rattle * (tree ? 1.4 : .7)) + tone * .35) * 1.3) * attack * tail;
  }
  return samples;
}

export function createBreakAudio(context, output, capacity = 8) {
  const buffers = new Map(), voices = new Set();
  let played = 0;
  for (const type of ['tree', 'cactus', 'rock', 'boulder']) {
    const data = synthesizeBreak(type, context.sampleRate), buffer = context.createBuffer(1, data.length, context.sampleRate);
    buffer.copyToChannel(data, 0); buffers.set(type, buffer);
  }
  function play(type, speed) {
    if (!buffers.has(type)) return;
    if (voices.size >= capacity) voices.values().next().value.stop();
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffers.get(type); gain.gain.value = Math.min(.42, .18 + speed * .003);
    source.connect(gain).connect(output);
    const voice = { stop() { source.stop(); source.disconnect(); gain.disconnect(); voices.delete(voice); } };
    source.onended = () => { source.disconnect(); gain.disconnect(); voices.delete(voice); };
    voices.add(voice); source.start(); played++;
  }
  return { play, clear() { for (const voice of [...voices]) voice.stop(); }, get played() { return played; }, get active() { return voices.size; } };
}
