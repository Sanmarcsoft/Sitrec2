<?php

session_start();

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

header('Content-Type: application/json');

$NLU_LOG_FILE = sys_get_temp_dir() . '/sitrec_nlu_fallbacks.json';
$MAX_LOG_ENTRIES = 1000;

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || empty($data['prompt'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing prompt']);
    exit;
}

$userInfo = getUserInfo();

$prompt = substr(trim($data['prompt']), 0, 500);
$apiCalls = $data['apiCalls'] ?? null;
$textResponse = isset($data['textResponse']) ? substr($data['textResponse'], 0, 1000) : null;
$timestamp = $data['timestamp'] ?? time() * 1000;

$logs = [];
if (file_exists($NLU_LOG_FILE)) {
    $content = file_get_contents($NLU_LOG_FILE);
    $logs = json_decode($content, true) ?: [];
}

$logs[] = [
    'timestamp' => $timestamp,
    'user_id' => $userInfo['user_id'],
    'prompt' => $prompt,
    'apiCalls' => $apiCalls,
    'textResponse' => $textResponse,
];

if (count($logs) > $MAX_LOG_ENTRIES) {
    $logs = array_slice($logs, -$MAX_LOG_ENTRIES);
}

file_put_contents($NLU_LOG_FILE, json_encode($logs, JSON_PRETTY_PRINT), LOCK_EX);

echo json_encode(['success' => true]);
