use anyhow::Result;
use sherpa_onnx::{VadModelConfig, VoiceActivityDetector as SherpaVad};

pub struct VoiceActivityDetector {
    vad: SherpaVad,
    buffer: Vec<f32>,
    offset: usize,
    window_size: usize,
}

impl VoiceActivityDetector {
    pub fn new(model_path: &std::path::Path, threshold: f32) -> Result<Self> {
        let mut config = VadModelConfig::default();
        config.silero_vad.model = Some(model_path.to_str().unwrap().into());
        config.silero_vad.threshold = threshold;
        config.silero_vad.min_silence_duration = 0.25;
        config.silero_vad.min_speech_duration = 0.25;
        config.silero_vad.max_speech_duration = 5.0;
        config.silero_vad.window_size = 512;
        config.sample_rate = 16000;
        config.debug = false;

        let vad = SherpaVad::create(&config, 60.0)
            .ok_or_else(|| anyhow::anyhow!("Failed to create Silero VAD"))?;

        Ok(Self {
            vad,
            buffer: Vec::new(),
            offset: 0,
            window_size: 512,
        })
    }

    pub fn feed(&mut self, samples: &[f32]) {
        self.buffer.extend_from_slice(samples);

        while self.offset + self.window_size <= self.buffer.len() {
            self.vad
                .accept_waveform(&self.buffer[self.offset..self.offset + self.window_size]);
            self.offset += self.window_size;
        }
    }

    pub fn try_get_segment(&mut self) -> Option<Vec<f32>> {
        if !self.vad.is_empty() {
            if let Some(segment) = self.vad.front() {
                self.vad.pop();
                return Some(segment.samples().to_vec());
            }
        }
        None
    }

    pub fn reset_after_segment(&mut self) {
        // Drain only consumed windows. Clearing the whole buffer here
        // starves the VAD whenever resampled chunks are smaller than the
        // 512-sample window (e.g. ~160 samples per 10ms chunk from a 48kHz
        // mic): nothing would ever reach accept_waveform again.
        self.buffer.drain(..self.offset);
        self.offset = 0;
    }
}
