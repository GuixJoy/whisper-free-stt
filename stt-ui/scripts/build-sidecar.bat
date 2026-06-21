@echo off
setlocal enabledelayedexpansion

rem Build the Python STT engine as a standalone binary for Tauri sidecar.

set "PROJECT_ROOT=%~dp0..\.."
cd /d "%PROJECT_ROOT%"

set "SIDECAR_DIR=%PROJECT_ROOT%\stt-ui\src-tauri\binaries"

rem Detect target triple
if defined TAURI_TARGET_TRIPLE (
    set "TARGET_TRIPLE=%TAURI_TARGET_TRIPLE%"
) else (
    for /f "tokens=2 delims= " %%i in ('rustc -vV ^| findstr host') do set "TARGET_TRIPLE=%%i"
)

echo Building sidecar for target: %TARGET_TRIPLE%

if not exist "%SIDECAR_DIR%" mkdir "%SIDECAR_DIR%"

set "SEP=;"

rem Detect Python command
where uv >nul 2>&1
if %errorlevel%==0 (
    set "PYTHON_CMD=uv run python"
) else (
    if exist "%PROJECT_ROOT%\.venv\Scripts\python.exe" (
        set "PYTHON_CMD=%PROJECT_ROOT%\.venv\Scripts\python.exe"
    ) else (
        set "PYTHON_CMD=python"
    )
)

echo Using Python command: %PYTHON_CMD%

set "WORK_DIR=%SIDECAR_DIR%\build\work"
set "SPEC_DIR=%SIDECAR_DIR%\build\spec"
if not exist "%WORK_DIR%" mkdir "%WORK_DIR%"
if not exist "%SPEC_DIR%" mkdir "%SPEC_DIR%"

%PYTHON_CMD% -m PyInstaller ^
    --onefile ^
    --name "stt-engine" ^
    --distpath "%SIDECAR_DIR%" ^
    --workpath "%WORK_DIR%" ^
    --specpath "%SPEC_DIR%" ^
    --add-data "%PROJECT_ROOT%\stt\prompts.py%SEP%stt" ^
    --collect-all sounddevice ^
    --collect-all numpy ^
    --collect-all faster_whisper ^
    --collect-all ctranslate2 ^
    --collect-all noisereduce ^
    --collect-all nvidia ^
    --hidden-import websockets ^
    --hidden-import pywhispercpp ^
    "%PROJECT_ROOT%\stt\cli.py"

copy /y "%SIDECAR_DIR%\stt-engine.exe" "%SIDECAR_DIR%\stt-engine-%TARGET_TRIPLE%.exe" >nul

rmdir /s /q "%SIDECAR_DIR%\build" 2>nul

echo Sidecar binary:  %SIDECAR_DIR%\stt-engine.exe
echo Target binary:  %SIDECAR_DIR%\stt-engine-%TARGET_TRIPLE%.exe
