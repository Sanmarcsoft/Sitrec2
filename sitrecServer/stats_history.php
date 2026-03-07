<?php
// stats_history.php - 28-day stats history recording and retrieval

require_once __DIR__ . '/config_paths.php';

function getStatsDir() {
    global $CACHE_PATH;
    $base = (isset($CACHE_PATH) && is_dir(dirname(rtrim($CACHE_PATH, '/'))))
        ? $CACHE_PATH
        : sys_get_temp_dir() . '/';
    $dir = $base . 'sitrec-stats/';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function getStatsHistoryFile() {
    return getStatsDir() . 'history.json';
}

function getVisitsFile($date) {
    return getStatsDir() . 'visits_' . $date . '.json';
}

function loadStatsHistory() {
    $file = getStatsHistoryFile();
    if (!file_exists($file)) return [];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

function saveStatsHistory($history) {
    // Prune to last 28 days
    ksort($history);
    while (count($history) > 28) {
        array_shift($history);
    }
    $file = getStatsHistoryFile();
    file_put_contents($file, json_encode($history), LOCK_EX);
}

// Record incremental stats for today. $stats is an associative array of key => increment.
function recordDailyStats($stats) {
    $today = date('Y-m-d');
    $history = loadStatsHistory();
    if (!isset($history[$today])) {
        $history[$today] = [];
    }
    foreach ($stats as $key => $value) {
        $history[$today][$key] = ($history[$today][$key] ?? 0) + $value;
    }
    saveStatsHistory($history);
}

// Record a visit with user ID and IP address
function recordVisit($userId, $ip, $sitch = null) {
    $today = date('Y-m-d');
    $file = getVisitsFile($today);

    $data = ['entries' => [], 'users' => [], 'ips' => []];
    if (file_exists($file)) {
        $loaded = json_decode(file_get_contents($file), true);
        if (is_array($loaded)) $data = $loaded;
    }

    $data['entries'][] = [
        'user_id' => $userId,
        'ip' => $ip,
        'time' => time(),
        'sitch' => $sitch,
    ];

    $uid = strval($userId);
    $data['users'][$uid] = ($data['users'][$uid] ?? 0) + 1;
    $data['ips'][$ip] = ($data['ips'][$ip] ?? 0) + 1;

    file_put_contents($file, json_encode($data), LOCK_EX);

    // Also update stats history with visit counts
    $history = loadStatsHistory();
    if (!isset($history[$today])) $history[$today] = [];
    $history[$today]['visits'] = ($history[$today]['visits'] ?? 0) + 1;
    $history[$today]['unique_users'] = count($data['users']);
    $history[$today]['unique_ips'] = count($data['ips']);
    saveStatsHistory($history);

    // Clean up visit files older than 28 days
    $cutoff = date('Y-m-d', strtotime('-28 days'));
    foreach (glob(getStatsDir() . 'visits_*.json') as $vf) {
        if (preg_match('/visits_(\d{4}-\d{2}-\d{2})\.json/', basename($vf), $m)) {
            if ($m[1] < $cutoff) @unlink($vf);
        }
    }
}

// Return 28 days of history, keyed by date, oldest first
function getStatsHistory28() {
    $history = loadStatsHistory();
    $result = [];
    for ($i = 27; $i >= 0; $i--) {
        $date = date('Y-m-d', strtotime("-{$i} days"));
        $result[$date] = $history[$date] ?? [];
    }
    return $result;
}

// Return visit details for a specific date
function getVisitDetails($date) {
    $file = getVisitsFile($date);
    if (!file_exists($file)) return ['entries' => [], 'users' => [], 'ips' => []];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : ['entries' => [], 'users' => [], 'ips' => []];
}
