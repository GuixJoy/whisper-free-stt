use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

pub struct AudioCapture {
    _stream: cpal::Stream,
    pub sample_rate: u32,
}

/// Downmix interleaved multi-channel samples to mono `f32`.
///
/// Each output sample is the arithmetic mean of one `channels`-wide frame,
/// after mapping each raw sample through `to_f32`.
fn normalize_to_mono<S: Copy>(data: &[S], channels: usize, to_f32: impl Fn(S) -> f32 + Copy) -> Vec<f32> {
    data.chunks(channels)
        .map(|frame| {
            let sum: f32 = frame.iter().copied().map(to_f32).sum();
            sum / channels as f32
        })
        .collect()
}

pub fn list_input_devices() -> Result<Vec<(String, String)>> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    for device in host.input_devices()? {
        let name = device.to_string();
        let id = device
            .id()
            .map(|d| format!("{:?}", d))
            .unwrap_or_default();
        devices.push((name, id));
    }

    Ok(devices)
}

pub fn start_capture<F>(device_name: Option<&str>, mut callback: F) -> Result<AudioCapture>
where
    F: FnMut(&[f32]) + Send + 'static,
{
    let host = cpal::default_host();
    let device = match device_name {
        Some(name) => host
            .input_devices()?
            .find(|d| d.to_string() == name)
            .ok_or_else(|| anyhow::anyhow!("Device not found: {}", name))?,
        None => host
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("No default input device"))?,
    };

    let supported = device.default_input_config()?;
    let config = supported.config();
    let sample_format = supported.sample_format();
    let sample_rate = supported.sample_rate();
    let channels = config.channels as usize;

    let err_fn = |err| eprintln!("Audio stream error: {:?}", err);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if data.is_empty() {
                    return;
                }
                let mono = normalize_to_mono(data, channels, |s| s);
                callback(&mono);
            },
            err_fn,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                if data.is_empty() {
                    return;
                }
                let mono = normalize_to_mono(data, channels, |s| s as f32 / i16::MAX as f32);
                callback(&mono);
            },
            err_fn,
            None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            config,
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                if data.is_empty() {
                    return;
                }
                let mono = normalize_to_mono(data, channels, |s| (s as f32 - 32768.0) / 32768.0);
                callback(&mono);
            },
            err_fn,
            None,
        )?,
        other => return Err(anyhow::anyhow!("Unsupported sample format: {:?}", other)),
    };

    stream.play()?;

    Ok(AudioCapture {
        _stream: stream,
        sample_rate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmixes_stereo_f32_by_averaging() {
        let mono = normalize_to_mono(&[0.5f32, -0.5, 1.0, 1.0], 2, |s| s);
        assert_eq!(mono, vec![0.0, 1.0]);
    }

    #[test]
    fn converts_i16_and_u16_samples() {
        let mono = normalize_to_mono(&[i16::MAX, 0], 2, |s| s as f32 / i16::MAX as f32);
        assert_eq!(mono, vec![0.5]);
        // u16 silence level (32768) maps to 0.0.
        let mono = normalize_to_mono(&[32768u16, 32768], 2, |s| {
            (s as f32 - 32768.0) / 32768.0
        });
        assert_eq!(mono, vec![0.0]);
    }
}
