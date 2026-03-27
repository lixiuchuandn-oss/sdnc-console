@echo off
REM Output must be ImageUploader.exe; plain "go build" uses wrong default name.
cd /d "%~dp0"
go build -trimpath -ldflags "-s -w" -o ImageUploader.exe .
if errorlevel 1 exit /b 1
echo Built: %~dp0ImageUploader.exe
