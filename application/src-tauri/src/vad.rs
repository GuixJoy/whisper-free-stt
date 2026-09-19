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
        self.buffer.clear();
        self.offset = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pure RMS threshold-learning rule (kept as a tested helper for future
    /// background-noise calibration work).
    fn learned_threshold(current: f32, samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return current;
        }
        const CALIBRATION_FACTOR: f32 = 3.0;
        let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
        let rms = (sum_sq / samples.len() as f32).sqrt();
        current.max((rms * CALIBRATION_FACTOR).min(1.0))
    }

    #[test]
    fn calibration_raises_threshold_on_loud_noise() {
        // RMS of [0.1, -0.1, 0.1, -0.1] is ~0.1 -> ~0.1 * 3.0 = ~0.3.
        let got = learned_threshold(0.05, &[0.1, -0.1, 0.1, -0.1]);
        assert!((got - 0.3).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn calibration_never_lowers_threshold_and_ignores_empty() {
        assert_eq!(learned_threshold(0.5, &[0.01, -0.01]), 0.5);
        assert_eq!(learned_threshold(0.5, &[]), 0.5);
    }
}
