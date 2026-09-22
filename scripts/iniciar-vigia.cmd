@echo off
rem Liga o vigia do robô do Gmail: atende "Verificar Gmail agora", "Enviar" e
rem "Salvar no Drive" da tela, e lê o Gmail sozinho a cada 2 horas.
rem Se o vigia cair, volta sozinho em 30 segundos. Se já houver um rodando,
rem este não liga. O registro fica em scripts\vigia-robo.log.
rem
rem Não abre janela nenhuma: fica só o ícone verde/cinza/vermelho na bandeja
rem do sistema, perto do relógio. Clique nele com o botão direito pra ver a
rem situação, abrir a tela do robô, ver o registro ou reiniciar.
cd /d "%~dp0"
wscript "%~dp0iniciar-vigia-oculto.vbs"
