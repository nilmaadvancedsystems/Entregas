<?php
require __DIR__ . '/cors.php';
require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
require_auth($pdo);

function row_to_entrega($row)
{
    return [
        "id" => (int) $row['id'],
        "clienteId" => $row['cliente_id'],
        "clienteNome" => $row['cliente_nome'],
        "competencia" => $row['competencia'],
        "itens" => json_decode($row['itens'], true),
        "recebedor" => $row['recebedor'],
        "assinatura" => $row['assinatura'],
        "foto" => $row['foto'],
        "geo" => ($row['geo_lat'] !== null) ? ["lat" => (float) $row['geo_lat'], "lng" => (float) $row['geo_lng']] : null,
        "status" => $row['status'],
        "criadoEm" => $row['criado_em'],
        "confirmadoEm" => $row['confirmado_em'],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (!empty($_GET['cliente_id'])) {
        $stmt = $pdo->prepare("SELECT * FROM entregas WHERE cliente_id = ? ORDER BY criado_em DESC LIMIT 200");
        $stmt->execute([$_GET['cliente_id']]);
    } elseif (!empty($_GET['status'])) {
        $stmt = $pdo->prepare("SELECT * FROM entregas WHERE status = ? ORDER BY criado_em ASC LIMIT 500");
        $stmt->execute([$_GET['status']]);
    } elseif (!empty($_GET['competencia'])) {
        $stmt = $pdo->prepare("SELECT * FROM entregas WHERE competencia = ? ORDER BY criado_em DESC LIMIT 1000");
        $stmt->execute([$_GET['competencia']]);
    } else {
        http_response_code(400);
        echo json_encode(["error" => "Informe competencia, cliente_id ou status."]);
        exit;
    }
    echo json_encode(array_map('row_to_entrega', $stmt->fetchAll()));
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $body['action'] ?? 'create';

    if ($action === 'create') {
        $geo = $body['geo'] ?? null;
        $stmt = $pdo->prepare(
            "INSERT INTO entregas
             (cliente_id, cliente_nome, competencia, itens, recebedor, assinatura, foto, geo_lat, geo_lng, status, criado_em, confirmado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute([
            $body['clienteId'] ?? '',
            $body['clienteNome'] ?? '',
            $body['competencia'] ?? '',
            json_encode($body['itens'] ?? []),
            $body['recebedor'] ?? '',
            $body['assinatura'] ?? null,
            $body['foto'] ?? null,
            $geo['lat'] ?? null,
            $geo['lng'] ?? null,
            $body['status'] ?? 'confirmada',
            $body['criadoEm'] ?? date('Y-m-d H:i:s'),
            $body['confirmadoEm'] ?? null,
        ]);
        echo json_encode(["id" => (int) $pdo->lastInsertId()]);
        exit;
    }

    if ($action === 'confirm') {
        $geo = $body['geo'] ?? null;
        $stmt = $pdo->prepare(
            "UPDATE entregas SET assinatura=?, foto=?, recebedor=?, geo_lat=?, geo_lng=?, status='confirmada', confirmado_em=?
             WHERE id=?"
        );
        $stmt->execute([
            $body['assinatura'] ?? null,
            $body['foto'] ?? null,
            $body['recebedor'] ?? '',
            $geo['lat'] ?? null,
            $geo['lng'] ?? null,
            $body['confirmadoEm'] ?? date('Y-m-d H:i:s'),
            $body['id'] ?? 0,
        ]);
        echo json_encode(["ok" => true]);
        exit;
    }
}

http_response_code(400);
echo json_encode(["error" => "Requisição inválida."]);
