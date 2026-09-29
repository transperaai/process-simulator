/**
 * Binary min-heap of timed events. Ties on time are broken by insertion
 * order, so the simulation is deterministic regardless of heap layout.
 */
export class EventQueue<T extends { t: number }> {
  private heap: { ev: T; seq: number }[] = [];
  private seq = 0;

  get size(): number {
    return this.heap.length;
  }

  push(ev: T): void {
    const heap = this.heap;
    heap.push({ ev, seq: this.seq++ });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
      i = parent;
    }
  }

  pop(): T | undefined {
    const heap = this.heap;
    if (!heap.length) return undefined;
    const top = heap[0]!.ev;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && this.less(l, m)) m = l;
        if (r < heap.length && this.less(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const x = this.heap[a]!;
    const y = this.heap[b]!;
    return x.ev.t < y.ev.t || (x.ev.t === y.ev.t && x.seq < y.seq);
  }
}
