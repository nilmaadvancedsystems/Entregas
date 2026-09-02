<?php
function require_auth($pdo)
{
    $authHeader = '';
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }
    if ($authHeader === '' && isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
    }

    if (!preg_match('/Bearer\s+(\S+)/', $authHeader, $m)) {
        http_response_code(401);
        echo json_encode(["error" => "Não autenticado."]);
        exit;
    }

    $stmt = $pdo->prepare(
        "SELECT usuarios.id, usuarios.nome FROM tokens
         JOIN usuarios ON usuarios.id = tokens.usuario_id
         WHERE tokens.token = ? AND tokens.expira_em > NOW()"
    );
    $stmt->execute([$m[1]]);
    $user = $stmt->fetch();

    if (!$user) {
        http_response_code(401);
        echo json_encode(["error" => "Sessão expirada, faça login novamente."]);
        exit;
    }

    return $user;
}
