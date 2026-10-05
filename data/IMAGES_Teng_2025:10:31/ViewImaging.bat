if exist "%SYSTEMDRIVE%\Program Files (x86)\" (
   start "" /d "%~dp0" "SDViewerLITE64.exe" "-a"
) else (
   start "" /d "%~dp0" "SDViewerLITE64.exe" "-a"
)
