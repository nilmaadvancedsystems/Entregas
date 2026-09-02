<?php
require __DIR__ . '/cors.php';
require __DIR__ . '/db.php';

$clientes = $pdo->query("SELECT COUNT(*) c FROM clientes")->fetch()['c'];
$usuarios = $pdo->query("SELECT COUNT(*) c FROM usuarios")->fetch()['c'];

echo json_encode([
    "ok" => true,
    "clientes" => (int) $clientes,
    "usuarios" => (int) $usuarios,
]);
