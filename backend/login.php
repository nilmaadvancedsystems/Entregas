<?php
require __DIR__ . '/cors.php';
require __DIR__ . '/db.php';

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$email = trim($body['email'] ?? '');
$senha = $body['senha'] ?? '';

if ($email === '' || $senha === '') {
    http_response_code(400);
    echo json_encode(["error" => "Informe e-mail e senha."]);
    exit;
}

$stmt = $pdo->prepare("SELECT * FROM usuarios WHERE email = ?");
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user || !password_verify($senha, $user['senha_hash'])) {
    http_response_code(401);
    echo json_encode(["error" => "E-mail ou senha inválidos."]);
    exit;
}

$token = bin2hex(random_bytes(32));
$expira = date('Y-m-d H:i:s', strtotime('+30 days'));
$stmt = $pdo->prepare("INSERT INTO tokens (token, usuario_id, expira_em) VALUES (?, ?, ?)");
$stmt->execute([$token, $user['id'], $expira]);

echo json_encode(["token" => $token, "nome" => $user['nome']]);
