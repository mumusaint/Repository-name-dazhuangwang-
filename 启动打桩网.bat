@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 打桩网目录: %CD%
echo 启动中... 浏览器打开 http://localhost:8080
echo 按 Ctrl+C 停止服务
python server.py
pause
