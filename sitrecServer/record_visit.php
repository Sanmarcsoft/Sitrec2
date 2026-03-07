<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

header('Content-Type: application/json');

if (!getenv('SITREC_TRACK_STATS')) {
    echo json_encode(['disabled' => true]);
    exit;
}

require_once __DIR__ . '/stats_history.php';

$userInfo = getUserInfo();
$userId = $userInfo['user_id'];
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

$sitch = $_GET['sitch'] ?? null;
if ($sitch) {
    $sitch = preg_replace('/[^a-zA-Z0-9_-]/', '', $sitch);
}

recordVisit($userId, $ip, $sitch);

echo json_encode(['ok' => true]);
