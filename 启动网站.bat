@echo off
chcp 936>nul
cd /d "%~dp0"
title 嘉Jaykou工具台 - 本地服务
echo ============================================
echo    嘉Jaykou工具台  ——  490 个在线工具
echo ============================================
echo.
echo 正在启动本地服务，请稍候...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
echo.
echo 服务已停止。
pause
