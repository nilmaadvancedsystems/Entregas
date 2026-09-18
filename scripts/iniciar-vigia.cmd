@echo off
rem Liga o vigia do robô do Gmail: atende o botão "Verificar Gmail agora" e o
rem "Enviar" das cobranças, e lê o Gmail sozinho a cada 2 horas.
rem O registro fica em scripts\vigia-robo.log.
cd /d "%~dp0"
start "Vigia do robo do Gmail" /min cmd /c "node vigia-robo.js --a-cada 120 >> vigia-robo.log 2>&1"
