export function createProfiler(enabled = false) {
  const measurements = new Map();
  return {
    record(name, ms) {
      if (!enabled) return;
      let entry = measurements.get(name);
      if (!entry) measurements.set(name, entry = { count: 0, total: 0, max: 0, recent: [] });
      entry.count++; entry.total += ms; entry.max = Math.max(entry.max, ms);
      if (entry.recent.length >= 2048) entry.recent.shift();
      entry.recent.push(ms);
    },
    measure(name, action) { if (!enabled) return action(); const start = performance.now(); try { return action(); } finally { this.record(name, performance.now() - start); } },
    snapshot() {
      return Object.fromEntries([...measurements].map(([name, entry]) => {
        const sorted = [...entry.recent].sort((a, b) => a - b);
        return [name, { count: entry.count, meanMs: +(entry.total / entry.count).toFixed(2), maxMs: +entry.max.toFixed(2), p95Ms: +sorted[Math.floor((sorted.length - 1) * .95)].toFixed(2) }];
      }));
    },
  };
}
