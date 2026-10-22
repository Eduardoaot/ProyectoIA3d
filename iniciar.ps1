# Arranca la app completa: Ollama (IA), backend (puerto 8000) oculto y frontend (puerto 5173) en esta.
# Uso, desde la raíz del proyecto:  powershell -ExecutionPolicy Bypass -File .\iniciar.ps1
param([switch]$DescargarModelo)
$root = $PSScriptRoot
$model = if ($env:CAUCE_MODEL) { $env:CAUCE_MODEL } else { 'llama3.1:8b' }
# 127.0.0.1 y no localhost: en Windows, localhost prueba primero IPv6 (::1), donde Ollama no escucha,
# y ese intento fallido tarda ~2 s, justo el tiempo de espera de cada prueba.
$ollamaUrl = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { 'http://127.0.0.1:11434' }

function Test-Ollama {
    try { Invoke-WebRequest -UseBasicParsing "$ollamaUrl/api/tags" -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

function Wait-Ollama([int]$seconds) {
    $t = 0
    while (-not (Test-Ollama) -and $t -lt $seconds) { Start-Sleep -Seconds 1; $t++ }
    return (Test-Ollama)
}

# --- Ollama: se usa el que ya esté encendido; el modelo se configura después o con -DescargarModelo ---
$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollama -and (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe")) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (-not $ollama) {
    Write-Host "No se encontró Ollama. Instálalo desde https://ollama.com; la app funcionará sin IA." -ForegroundColor Yellow
} else {
    if (Test-Ollama) {
        Write-Host "Ollama ya estaba encendido."
    } elseif (Get-Process -Name 'ollama', 'ollama app' -ErrorAction SilentlyContinue) {
        # El proceso existe pero aún no contesta (la app de la bandeja tarda en arrancar):
        # se espera en vez de lanzar un segundo servidor, que fallaría por el puerto ocupado.
        Write-Host "Ollama ya se está iniciando; esperando a que responda..."
        Wait-Ollama 60 | Out-Null
    } else {
        Write-Host "Encendiendo Ollama..."
        Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden
        Wait-Ollama 60 | Out-Null
    }
    if (Test-Ollama) {
        $tags = (Invoke-WebRequest -UseBasicParsing "$ollamaUrl/api/tags").Content | ConvertFrom-Json
        $available = [bool]($tags.models | Where-Object { $_.name -eq $model })
        if (-not $available -and $DescargarModelo) {
            Write-Host "Descargando el modelo $model (una sola vez, ~5 GB)..."
            & $ollama pull $model
            $available = $LASTEXITCODE -eq 0
        } elseif (-not $available) {
            Write-Host "Falta configurar $model. Puedes hacerlo después con 'ollama pull $model'; la app iniciará sin IA." -ForegroundColor Yellow
        }
        # Se carga el modelo en memoria ahora, en segundo plano, para que la primera lectura
        # de una historia no espere la carga. No cambia lo que responde la IA.
        $loaded = ((Invoke-WebRequest -UseBasicParsing "$ollamaUrl/api/ps").Content | ConvertFrom-Json).models | Where-Object { $_.name -eq $model }
        if (-not $available) {
            Write-Host "No se precarga un modelo pendiente de configurar."
        } elseif ($loaded) {
            Write-Host "Ollama listo con $model (ya estaba cargado en memoria)." -ForegroundColor Green
        } else {
            $warm = @{ model = $model; keep_alive = '30m' } | ConvertTo-Json -Compress
            Start-Job -ScriptBlock { param($u, $b) Invoke-WebRequest -UseBasicParsing "$u/api/generate" -Method Post -Body $b -ContentType 'application/json' -TimeoutSec 300 | Out-Null } -ArgumentList $ollamaUrl, $warm | Out-Null
            Write-Host "Ollama listo con $model (cargándolo en memoria en segundo plano)." -ForegroundColor Green
        }
    } else {
        Write-Host "Ollama no respondió; la app funcionará sin IA." -ForegroundColor Yellow
    }
}

# --- Backend ---
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = Join-Path $root "backend\.venv\Scripts\python.exe" }
if (-not (Test-Path $py)) {
    Write-Host "Falta el entorno del backend: creándolo..."
    python -m venv (Join-Path $root "backend\.venv")
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el entorno Python. Configura .venv antes de iniciar." }
    & $py -m pip install -r (Join-Path $root "backend\requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar las dependencias del backend." }
}
$backendLog = Join-Path $env:TEMP 'cauce-backend.log'
$backendErrors = Join-Path $env:TEMP 'cauce-backend-errors.log'
Start-Process -FilePath $py -WorkingDirectory $root -ArgumentList '-m', 'uvicorn', 'main:app', '--app-dir', 'backend', '--reload', '--host', '127.0.0.1', '--port', '8000' -WindowStyle Hidden -RedirectStandardOutput $backendLog -RedirectStandardError $backendErrors
Write-Host "Backend iniciado. Registro: $backendErrors"

# Se espera a que el backend conteste antes de abrir el navegador: si la página pide /api
# antes de tiempo, Vite registra «http proxy error ... ECONNREFUSED» (la app reintenta sola).
Write-Host "Esperando al backend en el puerto 8000..."
$t = 0
while ($t -lt 60) {
    try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8000/api/health" -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1; $t++ }
}
if ($t -ge 60) { Write-Host "El backend no respondió en 60 s; revisa su ventana. La página reintentará conectarse." -ForegroundColor Yellow }
else { Write-Host "Backend listo." -ForegroundColor Green }

# --- Frontend ---
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
    Push-Location (Join-Path $root "frontend"); npm install; Pop-Location
}
Start-Process "http://localhost:5173"
Set-Location (Join-Path $root "frontend")
npm run dev
