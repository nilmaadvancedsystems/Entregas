@echo off
rem Laço do vigia (chamado por iniciar-vigia.cmd). Não precisa abrir direto.
cd /d "%~dp0"
:de_novo
node vigia-robo.js --a-cada 120 >> vigia-robo.log 2>&1
if "%errorlevel%"=="3" goto fim
echo %date% %time% vigia parou (codigo %errorlevel%); religando em 30s >> vigia-robo.log
timeout /t 30 /nobreak >nul
goto de_novo
:fim
