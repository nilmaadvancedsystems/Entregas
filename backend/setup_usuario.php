<?php
// ATENÇÃO: esta página cria logins e NÃO tem senha própria de proteção.
// Use-a só durante a configuração inicial e DELETE este arquivo do
// servidor assim que criar os usuários da equipe.
require __DIR__ . '/db.php';

$msg = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $senha = $_POST['senha'] ?? '';
    $nome = trim($_POST['nome'] ?? '');
    if ($email !== '' && $senha !== '') {
        $hash = password_hash($senha, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare(
            "INSERT INTO usuarios (email, senha_hash, nome) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE senha_hash = VALUES(senha_hash), nome = VALUES(nome)"
        );
        $stmt->execute([$email, $hash, $nome]);
        $msg = "Usuário $email criado/atualizado com sucesso.";
    }
}
?>
<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Criar usuário</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:40px auto;">
  <h2>Criar usuário — Nilma Entregas</h2>
  <p style="color:#a5372f;"><b>Apague este arquivo do servidor depois de criar os usuários da equipe.</b></p>
  <?php if ($msg): ?><p style="color:green;"><?= htmlspecialchars($msg) ?></p><?php endif; ?>
  <form method="post">
    <p><input name="nome" placeholder="Nome" style="width:100%;padding:8px;box-sizing:border-box;"></p>
    <p><input name="email" placeholder="E-mail" style="width:100%;padding:8px;box-sizing:border-box;"></p>
    <p><input name="senha" placeholder="Senha" type="password" style="width:100%;padding:8px;box-sizing:border-box;"></p>
    <button type="submit">Criar / atualizar usuário</button>
  </form>
</body>
</html>
