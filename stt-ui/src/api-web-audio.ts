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

    async spawn() {
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

      const socket = io(`http://127.0.0.1:${wsPort}`, {
        transports: ["websocket"],
      });

      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", (err) => reject(new Error(`Socket.IO failed: ${err.message}`)));
      });

      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        const resampled = new Float32Array(16000);
        const ratio = audioContext.sampleRate / 16000;
        for (let i = 0; i < 16000; i++) {
          const idx = Math.floor(i * ratio);
          resampled[i] = idx < inputData.length ? inputData[idx] : 0;
        }
        socket.emit("audio-chunk", Array.from(resampled));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);

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
      console.log("[Engine] WebAudio connected");
    },

    kill() {
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

    start() {
      this.sendCommand({ type: "start_recording" });
    },

    stop() {
      this.sendCommand({ type: "stop_recording" });
    },

    sendCommand(cmd: Record<string, unknown>) {
      if (state?.socket) {
        state.socket.emit("command", cmd);
      }
    },
  };
}
