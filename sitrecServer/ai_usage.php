<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

$userInfo = getUserInfo();

if (!isAdmin($userInfo)) {
    http_response_code(403);
    die('Admin access required');
}

$RATE_LIMIT_DIR = sys_get_temp_dir() . '/sitrec_ratelimit/';

$usageData = [];

if (is_dir($RATE_LIMIT_DIR)) {
    $files = glob($RATE_LIMIT_DIR . 'user_*.json');
    foreach ($files as $file) {
        $basename = basename($file);
        if (preg_match('/user_(\d+)\.json/', $basename, $matches)) {
            $userId = (int)$matches[1];
            $data = json_decode(file_get_contents($file), true);
            if ($data && isset($data['hour'])) {
                $usageData[] = [
                    'user_id' => $userId,
                    'minute_count' => $data['minute']['count'] ?? 0,
                    'minute_reset' => $data['minute']['reset'] ?? 0,
                    'hour_count' => $data['hour']['count'] ?? 0,
                    'hour_reset' => $data['hour']['reset'] ?? 0,
                ];
            }
        }
    }
}

usort($usageData, fn($a, $b) => $b['hour_count'] <=> $a['hour_count']);

$userNames = [];
$fileDir = getenv('XENFORO_PATH');
if ($fileDir && file_exists($fileDir . 'src/XF.php')) {
    $userIds = array_column($usageData, 'user_id');
    if (!empty($userIds)) {
        $userFinder = \XF::finder('XF:User')->whereIds($userIds);
        foreach ($userFinder->fetch() as $user) {
            $userNames[$user->user_id] = $user->username;
        }
    }
}

?>
<!DOCTYPE html>
<html>
<head>
    <title>AI Usage Stats</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; max-width: 800px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .expired { color: #999; }
    </style>
</head>
<body>
    <h1>AI Chatbot Usage</h1>
    <p>Rate limit directory: <?= htmlspecialchars($RATE_LIMIT_DIR) ?></p>
    <table>
        <tr>
            <th>User ID</th>
            <th>Username</th>
            <th>Minute Count</th>
            <th>Minute Reset</th>
            <th>Hour Count</th>
            <th>Hour Reset</th>
        </tr>
        <?php foreach ($usageData as $row): ?>
        <tr>
            <td><?= $row['user_id'] ?></td>
            <td><?= htmlspecialchars($userNames[$row['user_id']] ?? 'Unknown') ?></td>
            <td><?= $row['minute_count'] ?></td>
            <td class="<?= $row['minute_reset'] < time() ? 'expired' : '' ?>">
                <?= date('Y-m-d H:i:s', $row['minute_reset']) ?>
            </td>
            <td><?= $row['hour_count'] ?></td>
            <td class="<?= $row['hour_reset'] < time() ? 'expired' : '' ?>">
                <?= date('Y-m-d H:i:s', $row['hour_reset']) ?>
            </td>
        </tr>
        <?php endforeach; ?>
    </table>
    <?php if (empty($usageData)): ?>
    <p>No usage data found.</p>
    <?php endif; ?>
</body>
</html>
