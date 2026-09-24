@echo off
rem Mantem o arquivador de pe: se ele cair, volta em 30 segundos. Codigo 3
rem quer dizer que ja existe outro rodando, e ai este sai.
cd /d "%~dp0"
:laco
node arquivador.js >> arquivador.log 2>&1
if %errorlevel%==3 exit /b
ping -n 31 127.0.0.1 >nul
goto laco
