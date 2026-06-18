// ── Web Audio mode: browser captures mic, streams PCM to Python via WebSocket ──
import { type STTApi, type STTEvent } from "./api";
import { micLevelEmitter } from "./utils/mic-emitter";

interface WebAudioState {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode | AudioWorkletNode | null;
  ws: WebSocket | null;
  levelAnimId: number | null;
}

let state: WebAudioState | null = null;

// Float32 PCM chunks are sent to Python via WebSocket.
// Python runs VAD + ASR and sends back STTEvent JSON.
export function createWebAudioApi(wsPort: number = 8765): STTApi {
  let listeners: Array<(e: STTEvent) => void> = [];

  return {
    onEvent(cb) { listeners.push(cb); },

    async start() {
      // 1. Open mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,  // let Python handle noise reduction
          autoGainControl: false,
        },
      });

      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);

      // 2. Connect to Python WebSocket
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("WebSocket connection failed"));
      });

      ws.onmessage = (msg) => {
        try {
          const event: STTEvent = JSON.parse(msg.data);
          for (const cb of listeners) cb(event);
        } catch { }
      };
      ws.onclose = () => {
        for (const cb of listeners) cb({ type: "state", state: "idle" });
      };

      // 3. Capture audio via ScriptProcessorNode (widely supported)
      // Buffer size 4096 = 256ms at 16kHz — good balance of latency vs overhead
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0); // mono

        // Resample if AudioContext sampleRate differs from 16kHz
        let chunk: Float32Array;
        if (audioContext.sampleRate !== 16000) {
          const ratio = 16000 / audioContext.sampleRate;
          const newLength = Math.round(inputData.length * ratio);
          chunk = new Float32Array(newLength);
          for (let i = 0; i < newLength; i++) {
            const srcIdx = i / ratio;
            const idx = Math.floor(srcIdx);
            const frac = srcIdx - idx;
            chunk[i] = idx + 1 < inputData.length
              ? inputData[idx] * (1 - frac) + inputData[idx + 1] * frac
              : inputData[idx];
          }
        } else {
          chunk = new Float32Array(inputData.length);
          chunk.set(inputData);
        }

        // Send as binary (float32 PCM)
        ws.send(chunk.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination); // needed for onaudioprocess to fire

      // Feed mic levels to waveform via micLevelEmitter
      const levelAnalyser = audioContext.createAnalyser();
      levelAnalyser.fftSize = 256;
      source.connect(levelAnalyser);
      const levelData = new Uint8Array(levelAnalyser.frequencyBinCount);
      let levelAnimId: number | null = null;
      const emitLevel = () => {
        levelAnalyser.getByteFrequencyData(levelData);
        const avg = levelData.reduce((a, b) => a + b, 0) / levelData.length;
        micLevelEmitter.emit(avg / 255);
        levelAnimId = requestAnimationFrame(emitLevel);
      };
      levelAnimId = requestAnimationFrame(emitLevel);

      state = { stream, audioContext, source, processor, ws, levelAnimId };
    },

    stop() {
      if (state) {
        if (state.levelAnimId) cancelAnimationFrame(state.levelAnimId);
        state.processor?.disconnect();
        state.source.disconnect();
        state.stream.getTracks().forEach((track) => track.stop());
        state.audioContext.close();
        state.ws?.close();
        state = null;
      }
      micLevelEmitter.emit(0);
      listeners = [];
    },
  };
}
