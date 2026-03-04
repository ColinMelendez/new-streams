/**
 * RingBuffer - O(1) FIFO queue with indexed access.
 *
 * Replaces plain JS arrays that are used as queues with shift()/push().
 * Array.shift() is O(n) because it copies all remaining elements;
 * RingBuffer.shift() is O(1) — it just advances a head pointer.
 *
 * Also provides O(1) trimFront(count) to replace Array.splice(0, count).
 */
export class RingBuffer<T> {
  private _backing: (T | undefined)[];
  private _head: number = 0;
  private _size: number = 0;
  private _capacity: number;

  constructor(initialCapacity: number = 16) {
    this._capacity = initialCapacity;
    this._backing = new Array(initialCapacity);
  }

  get length(): number {
    return this._size;
  }

  /**
   * Append an item to the tail. O(1) amortized.
   */
  push(item: T): void {
    if (this._size === this._capacity) {
      this._grow();
    }
    this._backing[(this._head + this._size) % this._capacity] = item;
    this._size++;
  }

  /**
   * Prepend an item to the head. O(1) amortized.
   */
  unshift(item: T): void {
    if (this._size === this._capacity) {
      this._grow();
    }
    this._head = (this._head - 1 + this._capacity) % this._capacity;
    this._backing[this._head] = item;
    this._size++;
  }

  /**
   * Remove and return the item at the head. O(1).
   */
  shift(): T | undefined {
    if (this._size === 0) return undefined;
    const item = this._backing[this._head];
    this._backing[this._head] = undefined; // Help GC
    this._head = (this._head + 1) % this._capacity;
    this._size--;
    return item;
  }

  /**
   * Read item at a logical index (0 = head). O(1).
   */
  get(index: number): T {
    return this._backing[(this._head + index) % this._capacity] as T;
  }

  /**
   * Remove `count` items from the head without returning them. O(count) for GC cleanup.
   */
  trimFront(count: number): void {
    if (count <= 0) return;
    if (count >= this._size) {
      this.clear();
      return;
    }
    for (let i = 0; i < count; i++) {
      this._backing[(this._head + i) % this._capacity] = undefined;
    }
    this._head = (this._head + count) % this._capacity;
    this._size -= count;
  }

  /**
   * Find the logical index of `item` (reference equality). O(n).
   * Returns -1 if not found.
   */
  indexOf(item: T): number {
    for (let i = 0; i < this._size; i++) {
      if (this._backing[(this._head + i) % this._capacity] === item) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Remove the item at logical `index`, shifting later elements. O(n) worst case.
   * Used only on rare abort-signal cancellation path.
   */
  removeAt(index: number): void {
    if (index < 0 || index >= this._size) return;
    for (let i = index; i < this._size - 1; i++) {
      const from = (this._head + i + 1) % this._capacity;
      const to = (this._head + i) % this._capacity;
      this._backing[to] = this._backing[from];
    }
    const last = (this._head + this._size - 1) % this._capacity;
    this._backing[last] = undefined;
    this._size--;
  }

  /**
   * Remove all items. O(n) for GC cleanup.
   */
  clear(): void {
    for (let i = 0; i < this._size; i++) {
      this._backing[(this._head + i) % this._capacity] = undefined;
    }
    this._head = 0;
    this._size = 0;
  }

  /**
   * Iterate over all items head-to-tail.
   */
  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this._size; i++) {
      yield this._backing[(this._head + i) % this._capacity] as T;
    }
  }

  /**
   * Double the backing capacity, linearizing the circular layout.
   */
  private _grow(): void {
    const newCapacity = this._capacity * 2;
    const newBacking: (T | undefined)[] = new Array(newCapacity);
    for (let i = 0; i < this._size; i++) {
      newBacking[i] = this._backing[(this._head + i) % this._capacity];
    }
    this._backing = newBacking;
    this._head = 0;
    this._capacity = newCapacity;
  }
}
