# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Python
- Use UV for Python package management. Confidence: 0.85

# AI/LLM
- Prefer DeepSeek API for LLM tasks when available. Confidence: 0.75

# Desktop UI
- Use Tauri for desktop applications instead of Tkinter. Confidence: 0.85
- Support all three platforms (Linux, macOS, Windows) for desktop apps. Confidence: 0.65
- Prefer full onboarding wizard experiences over minimal setup panels. Confidence: 0.65

# Packaging
- Bundle Python dependencies as standalone binaries with PyInstaller/Nuitka instead of requiring system Python. Confidence: 0.65

# Database
- Use SQLite for local data storage in desktop apps. Confidence: 0.75

# Performance
- Prioritize GPU acceleration when available. Confidence: 0.80
- Add --debug flag for detailed diagnostic console output. Confidence: 0.75
- Prioritize latency and accuracy over feature additions; do not add features that degrade response time or transcription quality. Confidence: 0.65

# Error Handling
- Surface errors directly on the UI rather than relying on console output or verbose diagnostic tooling. Confidence: 0.65

# Workflow
- When a bug is reported, directly investigate and fix the code rather than launching exploratory sub-agents or over-analyzing first. Jump into the relevant files immediately. Confidence: 0.70

# Code Style
- Follow functional programming principles: pure functions, referential transparency, immutable data, isolate side effects. Confidence: 0.70

# Workflow
- When a bug is reported, directly investigate and fix the code rather than launching exploratory sub-agents or over-analyzing first. Jump into the relevant files immediately. Confidence: 0.70
- Do not repeatedly investigate known noise/artifact files (like the `1` file); add them to .gitignore, remove them, and move on. Confidence: 0.70

# Packaging
- Bundle Python dependencies as standalone binaries with PyInstaller/Nuitka instead of requiring system Python. Confidence: 0.65
- For Tauri v2 sidecar: keep the binary named `stt-engine` AND a target-triple symlink (`stt-engine-{target_triple} -> stt-engine`). Dev mode needs the bare name, build needs the triple-suffixed name. Both must coexist in stt-ui/src-tauri/binaries/. Confidence: 0.75

