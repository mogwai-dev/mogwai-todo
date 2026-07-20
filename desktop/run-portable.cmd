@echo off
setlocal

if "%~1"=="" (
  set "APP_DIR=%~dp0..\out\TodoDesktop"
) else (
  set "APP_DIR=%~1"
)

pushd "%APP_DIR%" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] App directory not found: %APP_DIR%
  exit /b 1
)

if not exist "laufey_webview.exe" (
  echo [ERROR] Missing executable: %CD%\laufey_webview.exe
  popd
  exit /b 2
)

if not exist "TodoDesktop.dll" (
  echo [ERROR] Missing runtime dll: %CD%\TodoDesktop.dll
  popd
  exit /b 3
)

set "LAUFEY_RUNTIME_PATH=%CD%\TodoDesktop.dll"
echo Launching from %CD%
echo Runtime: %LAUFEY_RUNTIME_PATH%

"%CD%\laufey_webview.exe" --runtime "%LAUFEY_RUNTIME_PATH%"
set "EXIT_CODE=%ERRORLEVEL%"

popd
exit /b %EXIT_CODE%
