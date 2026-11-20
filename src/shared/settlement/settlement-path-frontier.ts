interface Entry {
  id: number;
  cost: number;
  priority: number;
  order: number;
}
/** Stable minimum frontier: route search visits useful cells before flooding distant open terrain. */
export const createPathFrontier = () => {
  const heap: Entry[] = [];
  let order = 0;
  const before = (a: Entry, b: Entry) =>
    a.priority < b.priority || (a.priority === b.priority && a.order < b.order);
  return {
    push(id: number, cost: number, priority: number) {
      const entry = { id, cost, priority, order: order++ };
      let index = heap.length;
      heap.push(entry);
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!before(entry, heap[parent]!)) break;
        heap[index] = heap[parent]!;
        index = parent;
      }
      heap[index] = entry;
    },
    pop() {
      const first = heap[0],
        last = heap.pop();
      if (!heap.length || !last) return first;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++;
        if (!before(heap[child]!, last)) break;
        heap[index] = heap[child]!;
        index = child;
      }
      heap[index] = last;
      return first;
    }
  };
};
