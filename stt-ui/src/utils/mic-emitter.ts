class MicLevelEmitter {
  private listeners = new Set<(level: number) => void>();

  subscribe(cb: (level: number) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emit(level: number) {
    this.listeners.forEach((cb) => {
      try {
        cb(level);
      } catch (e) {
        console.error("Error in mic listener", e);
      }
    });
  }
}

export const micLevelEmitter = new MicLevelEmitter();
