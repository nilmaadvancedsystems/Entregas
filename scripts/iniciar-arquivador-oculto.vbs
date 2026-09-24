' Liga o arquivador sem abrir janela. Quem chama isto e o iniciar-arquivador.cmd.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = pasta
shell.Run "cmd /c """ & pasta & "\arquivador-laco.cmd""", 0, False