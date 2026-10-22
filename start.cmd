@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0ThinkingCanvas.exe" (
  start "" "%~dp0ThinkingCanvas.exe"
  exit /b 0
)
if exist "E:\Anaconda\pythonw.exe" (
  start "" "E:\Anaconda\pythonw.exe" "%~dp0src\main.py"
  exit /b 0
)
where pythonw.exe >nul 2>nul
if not errorlevel 1 (
  start "" pythonw.exe "%~dp0src\main.py"
  exit /b 0
)
where python.exe >nul 2>nul
if not errorlevel 1 (
  start "" python.exe "%~dp0src\main.py"
  exit /b 0
)
echo Python was not found. Install Python or place ThinkingCanvas.exe beside this file.
pause
