# Arranca la app completa: Ollama (IA), backend (puerto 8000) en otra ventana y frontend (puerto 5173) en esta.
# Uso, desde la raíz del proyecto:  powershell -ExecutionPolicy Bypass -File .\iniciar.ps1
$root = $PSScriptRoot
$model = if ($env:CAUCE_MODEL) { $env:CAUCE_MODEL } else { 'llama3.1:8b' }
$ollamaUrl = if ($env:OLLAMA_HOST) { $env:OLLAMA_HOST } else { 'http://localhost:11434' }

function Test-Ollama {
    try { Invoke-WebRequest -UseBasicParsing "$ollamaUrl/api/tags" -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

function Wait-Ollama([int]$seconds) {
    $t = 0
    while (-not (Test-Ollama) -and $t -lt $seconds) { Start-Sleep -Seconds 1; $t++ }
    return (Test-Ollama)
}

# --- Ollama: se usa el que ya esté encendido; si no, se enciende. Se baja el modelo si falta ---
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
        Wait-Ollama 30 | Out-Null
    } else {
        Write-Host "Encendiendo Ollama..."
        Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden
        Wait-Ollama 30 | Out-Null
    }
    if (Test-Ollama) {
        $tags = (Invoke-WebRequest -UseBasicParsing "$ollamaUrl/api/tags").Content | ConvertFrom-Json
        if (-not ($tags.models | Where-Object { $_.name -eq $model })) {
            Write-Host "Descargando el modelo $model (una sola vez, ~5 GB)..."
            & $ollama pull $model
        }
        # Se carga el modelo en memoria ahora, en segundo plano, para que la primera lectura
        # de una historia no espere la carga. No cambia lo que responde la IA.
        $loaded = ((Invoke-WebRequest -UseBasicParsing "$ollamaUrl/api/ps").Content | ConvertFrom-Json).models | Where-Object { $_.name -eq $model }
        if ($loaded) {
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
$py = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Falta el entorno del backend: creándolo..."
    python -m venv (Join-Path $root "backend\.venv")
    & $py -m pip install -r (Join-Path $root "backend\requirements.txt")
}
Start-Process powershell -WorkingDirectory (Join-Path $root "backend") -ArgumentList "-NoExit", "-Command", "& '$py' -m uvicorn main:app --reload --port 8000"

# --- Frontend ---
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
    Push-Location (Join-Path $root "frontend"); npm install; Pop-Location
}
Start-Process "http://localhost:5173"
Set-Location (Join-Path $root "frontend")
npm run dev
