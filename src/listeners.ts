/** Listeners in the order added; the same function added twice is two entries, each removed by its own remover. */
export class Listeners<Listener> {
  private readonly entries = new Set<{ listener: Listener }>();

  get size() {
    return this.entries.size;
  }

  add(listener: Listener) {
    const entry = { listener };
    this.entries.add(entry);
    return () => void this.entries.delete(entry);
  }

  /** The current listeners, unaffected by any added or removed while they run. */
  list() {
    return Array.from(this.entries, ({ listener }) => listener);
  }

  clear() {
    this.entries.clear();
  }

  /**
   * Adds `listener` for a native subscription: `start` runs when it is the first listener, `stop` when its removal
   * leaves none. The remover may be called more than once.
   */
  subscribe(listener: Listener, start: () => void, stop: () => void) {
    const remove = this.add(listener);
    if (this.size === 1) start();
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      remove();
      if (this.size === 0) stop();
    };
  }
}
