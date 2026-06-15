class MicLevelEmitter {
  private listeners = new Set<(level: number) => void>();
  private animationFrameId: number | null = null;
  private analyser: AnalyserNode | null = null;

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

  startWebAudioMonitoring(analyser: AnalyserNode) {
    this.stopWebAudioMonitoring();
    this.analyser = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const emitLevel = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const normalizedLevel = average / 255;
      this.emit(normalizedLevel);
      this.animationFrameId = requestAnimationFrame(emitLevel);
    };
    this.animationFrameId = requestAnimationFrame(emitLevel);
  }

  stopWebAudioMonitoring() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.analyser = null;
  }
}

export const micLevelEmitter = new MicLevelEmitter();
