// ── Web Audio mode: browser captures mic, streams PCM via Socket.IO ──
import { type STTApi, type STTEvent } from "./api";
import { micLevelEmitter } from "./utils/mic-emitter";
import { io, Socket } from "socket.io-client";

interface WebAudioState {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode | null;
  socket: Socket;
  levelAnimId: number | null;
}

let state: WebAudioState | null = null;

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
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);

      // 2. Connect to Socket.IO
      const socket = io(`http://127.0.0.1:${wsPort}`, {
        transports: ["websocket"],
      });

      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", (err) => reject(new Error(`Socket.IO failed: ${err.message}`)));
      });

      // Listen for events from server
      const eventTypes = ["state", "raw", "processed", "llm_partial", "mic", "error", "dropped"];
      for (const eventType of eventTypes) {
        socket.on(eventType, (data: any) => {
          const event = { type: eventType, ...data } as STTEvent;
          for (const cb of listeners) cb(event);
        });
      }

      socket.on("disconnect", () => {
        for (const cb of listeners) cb({ type: "state", state: "idle" });
      });

      // 3. Capture audio via ScriptProcessorNode
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (event) => {
        if (!socket.connected) return;
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);

        // Resample if needed
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

        // Send as binary via Socket.IO
        socket.emit("audio_chunk", chunk.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Feed mic levels to waveform
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

      state = { stream, audioContext, source, processor, socket, levelAnimId };
    },

    stop() {
      if (state) {
        if (state.levelAnimId) cancelAnimationFrame(state.levelAnimId);
        state.processor?.disconnect();
        state.source.disconnect();
        state.stream.getTracks().forEach((track) => track.stop());
        state.audioContext.close();
        state.socket.disconnect();
        state = null;
      }
      micLevelEmitter.emit(0);
      listeners = [];
    },
  };
}
