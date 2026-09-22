' Liga o vigia do robô do Gmail sem abrir nenhuma janela (nem preta, nem
' minimizada). Quem chama isto é o iniciar-vigia.cmd.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c cd /d """ & pasta & """ && node vigia-tray.js", 0, False
