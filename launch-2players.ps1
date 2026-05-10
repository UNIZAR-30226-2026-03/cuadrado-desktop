#Requires -Version 5.1
param(
    [ValidateRange(1, 2)]
    [int]$Players = 2
)
$repoRoot   = $PSScriptRoot
$backendDir = Join-Path $repoRoot "cuadrado-backend\cubo"
$appDir     = Join-Path $repoRoot "cuadrado-desktop"

function Ensure-EnvFile {
    param([string]$Dir)
    $envPath = Join-Path $Dir ".env"
    if (-not (Test-Path $envPath)) {
        $examplePath = Join-Path $Dir ".env.example"
        if (Test-Path $examplePath) {
            Copy-Item $examplePath $envPath -Force
            Write-Host "Se creo .env desde .env.example" -ForegroundColor Green
        } else {
            Write-Host "ERROR: falta .env y no existe .env.example" -ForegroundColor Red
            Read-Host "Pulsa Enter para salir"
            exit 1
        }
    }
}

function Ensure-NodeModules {
    param(
        [string]$Dir,
        [string]$Name
    )
    $modulesPath = Join-Path $Dir "node_modules"
    if (-not (Test-Path $modulesPath)) {
        Write-Host "Instalando dependencias en $Name..." -ForegroundColor Cyan
        Push-Location $Dir
        npm install
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) {
            Write-Host "ERROR: fallo npm install en $Name." -ForegroundColor Red
            Read-Host "Pulsa Enter para salir"
            exit 1
        }
    }
}

function Start-DockerDesktop {
    $dockerOk = $false
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        docker info 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
    }

    if (-not $dockerOk) {
        $dockerPath = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
        if (-not (Test-Path $dockerPath)) {
            $dockerPath = Join-Path $Env:ProgramFiles(x86) "Docker\Docker\Docker Desktop.exe"
        }
        if (Test-Path $dockerPath) {
            Start-Process -FilePath $dockerPath | Out-Null
        }
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 2
            docker info 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break }
        }
    }

    if (-not $dockerOk) {
        Write-Host "ERROR: Docker no esta disponible. Abre Docker Desktop y reintenta." -ForegroundColor Red
        Read-Host "Pulsa Enter para salir"
        exit 1
    }
}

function Wait-ForPort {
    param(
        [int]$Port,
        [int]$TimeoutSec = 60
    )
    for ($i = 0; $i -lt $TimeoutSec; $i++) {
        if (Test-NetConnection -ComputerName localhost -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue) {
            return $true
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Get-PortProcessNames {
    param([int]$Port)
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    if (-not $pids) { return @() }
    return $pids |
        ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } |
        Where-Object { $_ } |
        Select-Object -ExpandProperty ProcessName -Unique
}

function Stop-LocalPostgres {
    param([int]$Players)
    $pgServices = sc.exe query type= all state= active 2>$null |
        Select-String -Pattern "SERVICE_NAME|NOMBRE_SERVICIO" |
        ForEach-Object { ($_ -split ':', 2)[1].Trim() } |
        Where-Object { $_ -match "postgres" } |
        Sort-Object -Unique

    $pgPids = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } |
        Where-Object { $_ -and $_.ProcessName -match "postgres" } |
        Select-Object -ExpandProperty Id -Unique

    if ($pgServices -or $pgPids) {
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if (-not $isAdmin) {
            Write-Host "Necesito permisos de administrador para parar PostgreSQL local." -ForegroundColor Yellow
            Write-Host "Relanzando como administrador..." -ForegroundColor Yellow
            Start-Process powershell -Verb RunAs -ArgumentList "-NoExit", "-File", "`"$PSCommandPath`"", "-Players", $Players
            exit 0
        }
        foreach ($svc in $pgServices) {
            Write-Host "Parando servicio Windows: $svc" -ForegroundColor Yellow
            Stop-Service $svc -Force -ErrorAction SilentlyContinue
        }
        foreach ($pid in $pgPids) {
            Write-Host "Parando proceso postgres.exe (PID $pid)" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }

    $pgStill = Get-PortProcessNames -Port 5432 | Where-Object { $_ -match "postgres" }
    if ($pgStill) {
        Write-Host "ERROR: postgres.exe sigue escuchando en :5432. Detenlo y reintenta." -ForegroundColor Red
        Read-Host "Pulsa Enter para salir"
        exit 1
    }
}

Ensure-EnvFile -Dir $backendDir
Ensure-NodeModules -Dir $backendDir -Name "cuadrado-backend"
Ensure-NodeModules -Dir $appDir -Name "cuadrado-desktop"
Stop-LocalPostgres -Players $Players

# --- BASE DE DATOS (Docker) ---
Write-Host "[1/5] Levantando base de datos..." -ForegroundColor Yellow
Start-DockerDesktop
Push-Location $backendDir
docker compose up -d
if (-not $?) {
    Write-Host "ERROR: Docker fallo. Asegurate de que Docker Desktop este corriendo." -ForegroundColor Red
    Pop-Location
    Read-Host "Pulsa Enter para salir"
    exit 1
}
Pop-Location

Write-Host "      Esperando que la BD este lista en :5432..." -ForegroundColor DarkGray
if (-not (Wait-ForPort -Port 5432 -TimeoutSec 60)) {
    Write-Host "ERROR: la BD no respondio en :5432." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}
Write-Host "      BD lista." -ForegroundColor Green

Write-Host "[2/5] Inicializando Prisma (db:init)..." -ForegroundColor Yellow
Push-Location $backendDir
npm run db:init
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) {
    Write-Host "ERROR: fallo db:init." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

# --- BACKEND (NestJS en ventana separada) ---
Write-Host "[3/5] Iniciando backend NestJS..." -ForegroundColor Yellow
$port3000Procs = Get-PortProcessNames -Port 3000
if ($port3000Procs -and -not ($port3000Procs -contains "node")) {
    Write-Host "ERROR: el puerto 3000 esta ocupado por otro proceso." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}
if (-not $port3000Procs) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendDir'; npm run start:dev" -WindowStyle Normal
}

Write-Host "      Esperando que NestJS arranque en :3000 (puede tardar ~30s)..." -ForegroundColor DarkGray
if (Wait-ForPort -Port 3000 -TimeoutSec 90) {
    Write-Host "      Backend listo en http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "ERROR: backend no respondio en 90s. Revisa la ventana de NestJS." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

# --- BUILD ANGULAR ---
Write-Host "[4/5] Compilando Angular (local)..." -ForegroundColor Yellow
Push-Location $appDir
npm run build -- --configuration local --base-href ./
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: fallo el build de Angular." -ForegroundColor Red
    Pop-Location
    Read-Host "Pulsa Enter para salir"
    exit 1
}
Pop-Location
Write-Host "      Build OK." -ForegroundColor Green

# --- ELECTRON con sesiones separadas ---
Write-Host "[5/5] Abriendo sesiones de juego..." -ForegroundColor Yellow
$userDir1 = Join-Path $appDir ".electron-player1"
$userDir2 = Join-Path $appDir ".electron-player2"

$electronExe = Join-Path $appDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    Write-Host "ERROR: Electron no esta instalado. Ejecuta 'npm install' en cuadrado-desktop." -ForegroundColor Red
    Read-Host "Pulsa Enter para salir"
    exit 1
}

$argUserDir1 = "--user-data-dir=$userDir1"
Start-Process -FilePath $electronExe -ArgumentList @(".", $argUserDir1) -WorkingDirectory $appDir -WindowStyle Normal
if ($Players -ge 2) {
    Start-Sleep -Seconds 2
    $argUserDir2 = "--user-data-dir=$userDir2"
    Start-Process -FilePath $electronExe -ArgumentList @(".", $argUserDir2) -WorkingDirectory $appDir -WindowStyle Normal
}

Write-Host ""
Write-Host "Todo listo." -ForegroundColor Green
if ($Players -ge 2) {
    Write-Host "  Dos ventanas Electron con sesiones separadas (localStorage aislado)." -ForegroundColor Cyan
} else {
    Write-Host "  Una ventana Electron con sesion separada (localStorage aislado)." -ForegroundColor Cyan
}
Write-Host "  Usuarios disponibles: popa / ruben / juan (o registrate)." -ForegroundColor Cyan
