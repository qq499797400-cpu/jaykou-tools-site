# serve.ps1 —— 嘉Jaykou工具台 本地静态服务启动器
# 优先用 Python（性能更好，支持断点续传）；没有 Python 时自动改用 Windows 自带的 .NET HttpListener。
# 由「启动网站.bat」调用，也可单独运行：powershell -ExecutionPolicy Bypass -File serve.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

# ---------- 工具函数 ----------
function Get-FreePort {
    param([int]$start = 8080)
    for ($p = $start; $p -lt ($start + 30); $p++) {
        $probe = $null
        try {
            $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
            $probe.Start(); $probe.Stop()
            return $p
        } catch {
            if ($probe) { try { $probe.Stop() } catch {} }
        }
    }
    return $start
}

function Wait-PortReady {
    param([int]$port, [int]$ms = 10000)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $ms) {
        $c = $null
        try {
            $c = New-Object System.Net.Sockets.TcpClient
            $c.Connect('127.0.0.1', $port)
            return $true
        } catch { Start-Sleep -Milliseconds 200 }
        finally { if ($c) { $c.Close() } }
    }
    return $false
}

$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.xml'  = 'application/xml; charset=utf-8'
    '.png'  = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'; '.gif' = 'image/gif'; '.svg' = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'
    '.wasm' = 'application/wasm'
    '.mp4'  = 'video/mp4'; '.webm' = 'video/webm'; '.mp3' = 'audio/mpeg'
    '.wav'  = 'audio/wav'; '.ogg' = 'audio/ogg'
    '.pdf'  = 'application/pdf'
    '.glb'  = 'model/gltf-binary'; '.gltf' = 'model/gltf+json'
    '.txt'  = 'text/plain; charset=utf-8'; '.md' = 'text/markdown; charset=utf-8'
    '.zip'  = 'application/zip'
}

$port = Get-FreePort
$url  = "http://localhost:$port/index.html"

# ---------- 方案一：Python（性能最佳） ----------
$usePy = $false
if (Get-Command python -ErrorAction SilentlyContinue) {
    $usePy = $true; $pyExe = 'python'; $pyArgs = @('-m', 'http.server', "$port", '--bind', '127.0.0.1')
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $usePy = $true; $pyExe = 'py'; $pyArgs = @('-3', '-m', 'http.server', "$port", '--bind', '127.0.0.1')
}

if ($usePy) {
    Write-Host "[方案 1] 使用 Python 启动本地服务（端口 $port）..." -ForegroundColor Green
    $proc = Start-Process -FilePath $pyExe -ArgumentList $pyArgs -WorkingDirectory $root -PassThru -WindowStyle Hidden
    if (Wait-PortReady $port) {
        Write-Host "服务已就绪：$url" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "浏览器将自动打开。保持本窗口开着，按【回车键】停止服务。" -ForegroundColor Yellow
        Start-Process $url
        Read-Host | Out-Null
    } else {
        Write-Host "服务启动超时。请检查端口 $port 是否被防火墙拦截。" -ForegroundColor Red
        Read-Host "按回车键退出" | Out-Null
    }
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    exit 0
}

# ---------- 方案二：.NET HttpListener（无需任何额外软件） ----------
Write-Host "[方案 2] 未检测到 Python，改用 Windows 自带组件启动（端口 $port）..." -ForegroundColor Green
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
    $listener.Start()
} catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "常见原因：8080 附近端口被占用，或当前账户无权监听。请以管理员身份重试。" -ForegroundColor Red
    Read-Host "按回车键退出" | Out-Null
    exit 1
}

Write-Host "服务已就绪：$url" -ForegroundColor Cyan
Write-Host ""
Write-Host "浏览器将自动打开。要停止服务，请直接关闭本窗口，或按 Ctrl+C。" -ForegroundColor Yellow
Write-Host ""
Start-Process $url

try {
    while ($listener.IsListening) {
        $ctx = $null
        try { $ctx = $listener.GetContext() } catch { break }
        if ($null -eq $ctx) { break }
        try {
            $rel = $ctx.Request.Url.AbsolutePath.TrimStart('/')
            if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
            $path = [System.IO.Path]::GetFullPath((Join-Path $root ($rel -replace '/', '\')))

            # 防目录穿越：只允许访问站点目录内的文件
            if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                $ctx.Response.StatusCode = 403
                $ctx.Response.Close()
                continue
            }
            if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }

            if (Test-Path $path -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($path).ToLower()
                $ct  = $mime[$ext]
                if (-not $ct) { $ct = 'application/octet-stream' }
                $ctx.Response.ContentType = $ct
                $ctx.Response.StatusCode  = 200
                $fs = [System.IO.File]::OpenRead($path)
                try { $fs.CopyTo($ctx.Response.OutputStream) } finally { $fs.Dispose() }
            } else {
                $ctx.Response.StatusCode = 404
                $b = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
                $ctx.Response.OutputStream.Write($b, 0, $b.Length)
            }
        } catch {
            try { $ctx.Response.StatusCode = 500 } catch {}
        } finally {
            try { $ctx.Response.Close() } catch {}
        }
    }
} finally {
    try { $listener.Stop(); $listener.Close() } catch {}
}
