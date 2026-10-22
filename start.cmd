@echo off
cd /d "%~dp0"
if exist "ThinkingCanvas.exe" (
  start "" "ThinkingCanvas.exe"
  exit /b 0
)
python app\shell.py
