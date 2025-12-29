<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

header('Content-Type: application/json');

if (getenv('SITREC_TRACK_STATS') !== 'true') {
    echo json_encode(['disabled' => true, 'message' => 'Stats tracking disabled']);
    exit;
}

$userInfo = getUserInfo();
$userId = $userInfo['user_id'];
$userGroups = $userInfo['user_groups'];
$isGuest = false;

if ($userId <= 0) {
    $isGuest = true;
    if (isset($_COOKIE['sitrec_guest_id'])) {
        $guestId = preg_replace('/[^a-f0-9]/i', '', $_COOKIE['sitrec_guest_id']);
        if (strlen($guestId) === 32) {
            $userId = 'guest_' . $guestId;
        }
    }
    if ($userId <= 0) {
        $guestId = bin2hex(random_bytes(16));
        setcookie('sitrec_guest_id', $guestId, time() + 86400 * 30, '/', '', true, true);
        $userId = 'guest_' . $guestId;
    }
    $userGroups = [0];
}

// Tile service rate limits by user group (tiles per hour)
// Groups: admin=3, registered=2, verified=9, sitrec=14
// Services: mapbox, maptiler, aws, osm, eox, other
$TILE_RATE_LIMITS = [
    3 => [ // admin - effectively unlimited
        'mapbox' => 1000000,
        'maptiler' => 1000000,
        'aws' => 1000000,
        'osm' => 1000000,
        'eox' => 1000000,
        'other' => 1000000,
    ],
    14 => [ // sitrec - premium
        'mapbox' => 5000,
        'maptiler' => 5000,
        'aws' => 50000,
        'osm' => 50000,
        'eox' => 20000,
        'other' => 10000,
    ],
    9 => [ // verified - mid tier
        'mapbox' => 2000,
        'maptiler' => 2000,
        'aws' => 20000,
        'osm' => 20000,
        'eox' => 10000,
        'other' => 5000,
    ],
    2 => [ // registered - basic
        'mapbox' => 500,
        'maptiler' => 500,
        'aws' => 10000,
        'osm' => 10000,
        'eox' => 5000,
        'other' => 2000,
    ],
    0 => [ // guest - minimal
        'mapbox' => 200,
        'maptiler' => 200,
        'aws' => 5000,
        'osm' => 5000,
        'eox' => 2000,
        'other' => 1000,
    ],
];

// Default limits for unrecognized groups
$DEFAULT_LIMITS = [
    'mapbox' => 100,
    'maptiler' => 100,
    'aws' => 5000,
    'osm' => 5000,
    'eox' => 2000,
    'other' => 1000,
];

$TILE_USAGE_DIR = sys_get_temp_dir() . '/sitrec_tile_usage/';

function getTileLimitsForUser($userGroups) {
    global $TILE_RATE_LIMITS, $DEFAULT_LIMITS;
    
    $limits = $DEFAULT_LIMITS;
    
    foreach ($userGroups as $group) {
        if (isset($TILE_RATE_LIMITS[$group])) {
            foreach ($TILE_RATE_LIMITS[$group] as $service => $limit) {
                $limits[$service] = max($limits[$service] ?? 0, $limit);
            }
        }
    }
    
    return $limits;
}

function getUserUsageFile($userId, $usageDir) {
    return $usageDir . "user_{$userId}.json";
}

function loadUserUsage($userId, $usageDir) {
    $file = getUserUsageFile($userId, $usageDir);
    $now = time();
    
    if (!file_exists($file)) {
        return [
            'hourly' => [],
            'daily' => [],
            'hourReset' => $now + 3600,
            'dayReset' => $now + 86400,
        ];
    }
    
    $data = json_decode(file_get_contents($file), true);
    if (!$data) {
        return [
            'hourly' => [],
            'daily' => [],
            'hourReset' => $now + 3600,
            'dayReset' => $now + 86400,
        ];
    }
    
    // Reset hourly counts if hour has passed
    if ($now > ($data['hourReset'] ?? 0)) {
        $data['hourly'] = [];
        $data['hourReset'] = $now + 3600;
    }
    
    // Reset daily counts if day has passed
    if ($now > ($data['dayReset'] ?? 0)) {
        $data['daily'] = [];
        $data['dayReset'] = $now + 86400;
    }
    
    return $data;
}

function saveUserUsage($userId, $usageDir, $data) {
    if (!is_dir($usageDir)) {
        @mkdir($usageDir, 0755, true);
    }
    $file = getUserUsageFile($userId, $usageDir);
    file_put_contents($file, json_encode($data), LOCK_EX);
}

// Handle GET request - fetch current usage and limits
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $limits = getTileLimitsForUser($userGroups);
    $usage = loadUserUsage($userId, $TILE_USAGE_DIR);
    
    $remaining = [];
    foreach ($limits as $service => $limit) {
        $used = $usage['hourly'][$service] ?? 0;
        $remaining[$service] = max(0, $limit - $used);
    }
    
    echo json_encode([
        'userId' => $userId,
        'isGuest' => $isGuest,
        'userGroups' => $userGroups,
        'limits' => $limits,
        'usage' => $usage['hourly'],
        'remaining' => $remaining,
        'hourReset' => $usage['hourReset'],
        'dailyUsage' => $usage['daily'],
    ]);
    exit;
}

// Handle POST request - report usage
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['usage'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid request body']);
        exit;
    }
    
    $reportedUsage = $input['usage'];
    $limits = getTileLimitsForUser($userGroups);
    $currentUsage = loadUserUsage($userId, $TILE_USAGE_DIR);
    
    $warnings = [];
    $blocked = [];
    
    // Validate and accumulate usage
    foreach ($reportedUsage as $service => $count) {
        // Sanitize service name
        $service = preg_replace('/[^a-z0-9_-]/i', '', $service);
        if (empty($service)) continue;
        
        // Sanitize count
        $count = max(0, intval($count));
        if ($count <= 0) continue;
        
        // Add to hourly usage
        $currentUsage['hourly'][$service] = ($currentUsage['hourly'][$service] ?? 0) + $count;
        
        // Add to daily usage (for audit purposes)
        $currentUsage['daily'][$service] = ($currentUsage['daily'][$service] ?? 0) + $count;
        
        // Check if over limit
        $limit = $limits[$service] ?? $limits['other'] ?? 1000;
        if ($currentUsage['hourly'][$service] > $limit) {
            $blocked[$service] = [
                'used' => $currentUsage['hourly'][$service],
                'limit' => $limit,
            ];
        } elseif ($currentUsage['hourly'][$service] > $limit * 0.8) {
            $warnings[$service] = [
                'used' => $currentUsage['hourly'][$service],
                'limit' => $limit,
                'remaining' => $limit - $currentUsage['hourly'][$service],
            ];
        }
    }
    
    saveUserUsage($userId, $TILE_USAGE_DIR, $currentUsage);
    
    $remaining = [];
    foreach ($limits as $service => $limit) {
        $used = $currentUsage['hourly'][$service] ?? 0;
        $remaining[$service] = max(0, $limit - $used);
    }
    
    echo json_encode([
        'success' => true,
        'usage' => $currentUsage['hourly'],
        'remaining' => $remaining,
        'warnings' => $warnings,
        'blocked' => $blocked,
        'hourReset' => $currentUsage['hourReset'],
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
