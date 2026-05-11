$ErrorActionPreference = 'Continue'
Set-Location 'c:\Users\USUARIO\PSoftware\repositorio\cuadrado-desktop'
$log = Join-Path $PSScriptRoot 'electron-build-admin.log'
"=== Build elevated start: $(Get-Date -Format o) ===" | Out-File -FilePath $log -Encoding utf8
try {
    npm run electron:build *>&1 | Tee-Object -FilePath $log -Append
    "=== Exit code: $LASTEXITCODE ===" | Out-File -FilePath $log -Append -Encoding utf8
} catch {
    "EXCEPTION: $_" | Out-File -FilePath $log -Append -Encoding utf8
}
"=== Build elevated end: $(Get-Date -Format o) ===" | Out-File -FilePath $log -Append -Encoding utf8
