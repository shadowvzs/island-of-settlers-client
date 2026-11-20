/** Binary min-heap of integer ids keyed by a float priority (priority flood, A*). */
export class MinHeap {
  private ids: Int32Array;
  private priorities: Float64Array;
  private length = 0;

  constructor(capacity: number) {
    this.ids = new Int32Array(capacity);
    this.priorities = new Float64Array(capacity);
  }

  get size() {
    return this.length;
  }

  push(id: number, priority: number) {
    if (this.length === this.ids.length) this.grow();
    let index = this.length;
    this.length += 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priorities[parent]! <= priority) break;
      this.ids[index] = this.ids[parent]!;
      this.priorities[index] = this.priorities[parent]!;
      index = parent;
    }
    this.ids[index] = id;
    this.priorities[index] = priority;
  }

  /** Removes and returns the id with the lowest priority; -1 when empty. */
  pop() {
    if (this.length === 0) return -1;
    const top = this.ids[0]!;
    this.length -= 1;
    const lastId = this.ids[this.length]!;
    const lastPriority = this.priorities[this.length]!;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.length) break;
      const right = left + 1;
      const child =
        right < this.length && this.priorities[right]! < this.priorities[left]! ? right : left;
      if (this.priorities[child]! >= lastPriority) break;
      this.ids[index] = this.ids[child]!;
      this.priorities[index] = this.priorities[child]!;
      index = child;
    }
    this.ids[index] = lastId;
    this.priorities[index] = lastPriority;
    return top;
  }

  private grow() {
    const ids = new Int32Array(this.ids.length * 2);
    const priorities = new Float64Array(this.priorities.length * 2);
    ids.set(this.ids);
    priorities.set(this.priorities);
    this.ids = ids;
    this.priorities = priorities;
  }
}
