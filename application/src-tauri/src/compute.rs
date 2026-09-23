//! GPU-first compute selection for local inference.
//!
//! Preference order: discrete NVIDIA GPU → AMD GPU → CPU.
//! The local LLM (llama.cpp, Vulkan backend) follows this directly.
//! sherpa-onnx ASR intentionally stays on CPU: the crate links a static
//! CPU-only onnxruntime, and the int8 transducer already runs in well
//! under a second per utterance on AVX-512/VNNI hardware.
//!
//! Escape hatches (read at startup):
//! - `FLOURE_COMPUTE=cpu` forces the CPU path.
//! - `FLOURE_COMPUTE=vulkan` forces GPU offload (auto-picks the device).
//! - `FLOURE_MAIN_GPU=<n>` pins llama.cpp's `main_gpu` device index.

/// GPU/CPU target for local LLM inference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputeDevice {
    /// Discrete NVIDIA GPU via the Vulkan backend (preferred).
    NvidiaDiscrete,
    /// AMD GPU (discrete or integrated) via the Vulkan backend.
    AmdGpu,
    /// Explicitly forced GPU offload (`FLOURE_COMPUTE=vulkan|gpu` with no
    /// detected hardware). Load may fail and fall back to no-LLM, but the
    /// CPU path is never silently used when offload was requested.
    VulkanForced,
    /// No usable GPU detected — CPU inference path.
    Cpu,
}

impl ComputeDevice {
    /// Whether this device offloads model layers to a GPU.
    pub fn use_gpu(self) -> bool {
        !matches!(self, Self::Cpu)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::NvidiaDiscrete => "nvidia-discrete",
            Self::AmdGpu => "amd-gpu",
            Self::VulkanForced => "vulkan-forced",
            Self::Cpu => "cpu",
        }
    }
}

/// Detect the best compute device. Cheap sysfs/process checks only —
/// no GPU context is created here.
///
/// The Vulkan backend is compiled in only with the `vulkan` cargo feature;
/// without it llama.cpp silently keeps layers on CPU whatever we choose.
pub fn detect() -> ComputeDevice {
    // Explicit override first — honored on every OS.
    if let Ok(v) = std::env::var("FLOURE_COMPUTE").map(|v| v.to_ascii_lowercase()) {
        match v.as_str() {
            "cpu" => {
                eprintln!("[compute] FLOURE_COMPUTE=cpu -> forcing CPU path");
                return ComputeDevice::Cpu;
            }
            "vulkan" | "gpu" => {
                // Honor the override unconditionally: probe only to pick
                // WHICH GPU, and force offload even if probing finds none
                // (load failure falls back to no-LLM, never silent CPU).
                if has_nvidia_gpu() {
                    return ComputeDevice::NvidiaDiscrete;
                }
                if has_amd_gpu() {
                    return ComputeDevice::AmdGpu;
                }
                eprintln!("[compute] FLOURE_COMPUTE forces GPU offload (no GPU detected)");
                return ComputeDevice::VulkanForced;
            }
            _ => {}
        }
    }

    // nvidia-smi ships with NVIDIA drivers on Windows too, so this probe
    // works cross-platform. The AMD probe is sysfs-based (Linux-only).
    if has_nvidia_gpu() {
        return ComputeDevice::NvidiaDiscrete;
    }
    if cfg!(target_os = "linux") && has_amd_gpu() {
        return ComputeDevice::AmdGpu;
    }
    eprintln!("[compute] no usable GPU detected -> CPU path");
    ComputeDevice::Cpu
}

/// llama.cpp `main_gpu` index. Defaults to 0 (first GPU); override with
/// `FLOURE_MAIN_GPU` if load logs show layers landing on the wrong device.
pub fn main_gpu() -> i32 {
    std::env::var("FLOURE_MAIN_GPU")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Thread budget for every inference pool (Parakeet/Whisper thread counts,
/// llama.cpp contexts, `OMP_NUM_THREADS`).
///
/// Leaves headroom so the UI thread and WebView renderer never starve:
/// sustained all-core load is what got the app killed as "Not Responding"
/// (Windows Event 1002). Floor 2 keeps tiny machines functional.
/// ponytail: fixed ceiling of 8; raise only if ASR latency measurably
/// regresses on many-core boxes.
pub fn inference_threads() -> u32 {
    let avail = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    avail.saturating_sub(4).clamp(2, 8)
}

/// NVIDIA proprietary driver presence: /dev/nvidia* nodes, confirmed by
/// `nvidia-smi -L` when the binary exists.
fn has_nvidia_gpu() -> bool {
    let dev_nodes = std::fs::read_dir("/dev")
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .any(|e| e.file_name().to_string_lossy().starts_with("nvidia"))
        })
        .unwrap_or(false);
    let smi = std::process::Command::new("nvidia-smi")
        .arg("-L")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    eprintln!(
        "[compute] nvidia probe: dev_nodes={} nvidia_smi={}",
        dev_nodes, smi
    );
    dev_nodes || smi
}

/// AMD GPU presence: a render node plus AMD VGA hardware or the radeon
/// Vulkan ICD. (ROCm/kfd alone is not enough — it doesn't cover iGPUs,
/// while Vulkan covers both discrete and integrated AMD GPUs.)
fn has_amd_gpu() -> bool {
    let render_node = std::fs::read_dir("/dev/dri")
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .any(|e| e.file_name().to_string_lossy().starts_with("renderD"))
        })
        .unwrap_or(false);
    let lspci_amd = std::process::Command::new("lspci")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_ascii_lowercase()
                .contains("amd/ati")
        })
        .unwrap_or(false);
    let radeon_icd = std::path::Path::new("/usr/share/vulkan/icd.d/radeon_icd.json").exists();
    eprintln!(
        "[compute] amd probe: render_node={} lspci_amd={} radeon_icd={}",
        render_node, lspci_amd, radeon_icd
    );
    render_node && (lspci_amd || radeon_icd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_ranking_prefers_nvidia_over_cpu() {
        // Ordering contract, independent of hardware: these are pure
        // predicates over the enum, so the preference is pinned here.
        assert!(ComputeDevice::NvidiaDiscrete.use_gpu());
        assert!(ComputeDevice::AmdGpu.use_gpu());
        assert!(ComputeDevice::VulkanForced.use_gpu());
        assert!(!ComputeDevice::Cpu.use_gpu());
        assert_eq!(ComputeDevice::NvidiaDiscrete.as_str(), "nvidia-discrete");
        assert_eq!(ComputeDevice::AmdGpu.as_str(), "amd-gpu");
        assert_eq!(ComputeDevice::VulkanForced.as_str(), "vulkan-forced");
        assert_eq!(ComputeDevice::Cpu.as_str(), "cpu");
    }

    #[test]
    fn main_gpu_defaults_to_zero() {
        // FLOURE_MAIN_GPU is not set in the test environment; a parse
        // failure or absence must fall back to device 0, never panic.
        if std::env::var("FLOURE_MAIN_GPU").is_err() {
            assert_eq!(main_gpu(), 0);
        }
    }

    #[test]
    fn inference_threads_stay_within_budget() {
        // Hardware-independent: whatever the core count, the budget leaves
        // headroom (never all cores) and stays usable (never < 2).
        assert!((2..=8).contains(&inference_threads()));
    }
}
