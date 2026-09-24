@echo off
rem Liga o arquivador: atende o "Arquivar agora" do Pendencias e publica no
rem banco o que a rotina Claudio Secretario arquivou. Nao abre janela; o
rem registro fica em scripts\arquivador.log. Fica na pasta Inicializar do
rem Windows, entao liga sozinho quando o PC liga.
cd /d "%~dp0"
wscript "%~dp0iniciar-arquivador-oculto.vbs"
