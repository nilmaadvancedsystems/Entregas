@echo off
rem Liga o vigia do robô do Gmail: atende "Verificar Gmail agora", "Enviar" e
rem "Salvar no Drive" da tela, e lê o Gmail sozinho a cada 2 horas.
rem Se o vigia cair, volta sozinho em 30 segundos. Se já houver um rodando,
rem este não liga (código 3). O registro fica em scripts\vigia-robo.log.
cd /d "%~dp0"
start "Vigia do robo do Gmail" /min cmd /c "%~dp0vigia-laco.cmd"
