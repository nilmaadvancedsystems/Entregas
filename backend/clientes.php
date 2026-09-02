<?php
require __DIR__ . '/cors.php';
require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require_auth($pdo);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $busca = trim($_GET['busca'] ?? '');
    if ($busca !== '') {
        $like = "%$busca%";
        $stmt = $pdo->prepare("SELECT * FROM clientes WHERE nome LIKE ? OR codigo_origem LIKE ? ORDER BY nome LIMIT 1000");
        $stmt->execute([$like, $like]);
    } else {
        $stmt = $pdo->query("SELECT * FROM clientes ORDER BY nome LIMIT 2000");
    }
    echo json_encode($stmt->fetchAll());
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $body['action'] ?? 'create';

    if ($action === 'create') {
        $nome = trim($body['nome'] ?? '');
        if ($nome === '') {
            http_response_code(400);
            echo json_encode(["error" => "Nome é obrigatório."]);
            exit;
        }
        $id = 'c' . bin2hex(random_bytes(8));
        $stmt = $pdo->prepare(
            "INSERT INTO clientes (id, nome, documento, telefone, ativo, criado_em) VALUES (?, ?, ?, ?, 1, NOW())"
        );
        $stmt->execute([$id, $nome, trim($body['documento'] ?? ''), trim($body['telefone'] ?? '')]);
        $stmt = $pdo->prepare("SELECT * FROM clientes WHERE id = ?");
        $stmt->execute([$id]);
        echo json_encode($stmt->fetch());
        exit;
    }

    if ($action === 'update') {
        $id = $body['id'] ?? '';
        $ativo = !empty($body['ativo']) ? 1 : 0;
        $stmt = $pdo->prepare("UPDATE clientes SET ativo = ? WHERE id = ?");
        $stmt->execute([$ativo, $id]);
        echo json_encode(["ok" => true]);
        exit;
    }
}

http_response_code(400);
echo json_encode(["error" => "Requisição inválida."]);
