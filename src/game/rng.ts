/** Mulberry32 seeded PRNG */
export function createRng(seed: number) {
  let s = seed >>> 0;
  return {
    next(): number {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number): number {
      return Math.floor(this.next() * maxExclusive);
    },
    pick<T>(arr: T[]): T {
      return arr[this.int(arr.length)]!;
    },
    shuffle<T>(arr: T[]): T[] {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    },
  };
}

export type Rng = ReturnType<typeof createRng>;
