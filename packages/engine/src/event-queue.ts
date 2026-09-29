interface Node<T> {
  t: number;
  seq: number;
  ev: T;
}

/**
 * Binary min-heap of timed events. Ties on time are broken by insertion
 * order, so the simulation is deterministic regardless of heap layout.
 */
export class EventQueue<T extends { t: number }> {
  private heap: Node<T>[] = [];
  private seq = 0;

  get size(): number {
    return this.heap.length;
  }

  push(ev: T): void {
    const heap = this.heap;
    const node: Node<T> = { t: ev.t, seq: this.seq++, ev };
    let i = heap.length;
    heap.push(node);
    // Sift up: move parents down into the hole until the node fits.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = heap[parent]!;
      if (!before(node, p)) break;
      heap[i] = p;
      i = parent;
    }
    heap[i] = node;
  }

  pop(): T | undefined {
    const heap = this.heap;
    if (!heap.length) return undefined;
    const top = heap[0]!.ev;
    const last = heap.pop()!;
    const n = heap.length;
    if (n) {
      // Sift down: move the smaller child up into the hole until `last` fits.
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        let c = l;
        let child = heap[l]!;
        if (l + 1 < n && before(heap[l + 1]!, child)) {
          c = l + 1;
          child = heap[c]!;
        }
        if (!before(child, last)) break;
        heap[i] = child;
        i = c;
      }
      heap[i] = last;
    }
    return top;
  }
}

function before<T>(x: Node<T>, y: Node<T>): boolean {
  return x.t < y.t || (x.t === y.t && x.seq < y.seq);
}
