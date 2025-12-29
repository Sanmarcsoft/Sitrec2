<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

$userInfo = getUserInfo();

if (!in_array(3, $userInfo['user_groups'])) {
    http_response_code(403);
    die('Admin access required');
}

$TILE_USAGE_DIR = sys_get_temp_dir() . '/sitrec_tile_usage/';

$usageData = [];

if (is_dir($TILE_USAGE_DIR)) {
    $files = glob($TILE_USAGE_DIR . 'user_*.json');
    foreach ($files as $file) {
        $basename = basename($file);
        if (preg_match('/user_(\d+)\.json/', $basename, $matches)) {
            $userId = (int)$matches[1];
            $data = json_decode(file_get_contents($file), true);
            if ($data) {
                $now = time();
                $hourlyExpired = $now > ($data['hourReset'] ?? 0);
                $dailyExpired = $now > ($data['dayReset'] ?? 0);
                
                $usageData[] = [
                    'user_id' => $userId,
                    'hourly' => $hourlyExpired ? [] : ($data['hourly'] ?? []),
                    'daily' => $dailyExpired ? [] : ($data['daily'] ?? []),
                    'hour_reset' => $data['hourReset'] ?? 0,
                    'day_reset' => $data['dayReset'] ?? 0,
                    'hourly_expired' => $hourlyExpired,
                    'daily_expired' => $dailyExpired,
                ];
            }
        }
    }
}

usort($usageData, function($a, $b) {
    $aTotal = array_sum($a['daily']);
    $bTotal = array_sum($b['daily']);
    return $bTotal <=> $aTotal;
});

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

$allServices = [];
foreach ($usageData as $row) {
    $allServices = array_merge($allServices, array_keys($row['hourly']), array_keys($row['daily']));
}
$allServices = array_unique($allServices);
sort($allServices);

?>
<!DOCTYPE html>
<html>
<head>
    <title>Tile Usage Stats</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .expired { color: #999; }
        .warning { background-color: #fff3cd; }
        .danger { background-color: #f8d7da; }
        .service-header { writing-mode: vertical-rl; text-orientation: mixed; }
        h2 { margin-top: 30px; }
        .summary { margin-bottom: 20px; padding: 10px; background: #e7f3ff; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>Tile Usage Statistics</h1>
    <p>Usage directory: <?= htmlspecialchars($TILE_USAGE_DIR) ?></p>
    
    <?php
    $totalHourly = [];
    $totalDaily = [];
    foreach ($usageData as $row) {
        foreach ($row['hourly'] as $service => $count) {
            $totalHourly[$service] = ($totalHourly[$service] ?? 0) + $count;
        }
        foreach ($row['daily'] as $service => $count) {
            $totalDaily[$service] = ($totalDaily[$service] ?? 0) + $count;
        }
    }
    ?>
    
    <div class="summary">
        <strong>Total Hourly:</strong> <?= array_sum($totalHourly) ?> tiles
        (<?php
            $parts = [];
            foreach ($totalHourly as $s => $c) $parts[] = "$s: $c";
            echo implode(', ', $parts) ?: 'none';
        ?>)<br>
        <strong>Total Daily:</strong> <?= array_sum($totalDaily) ?> tiles
        (<?php
            $parts = [];
            foreach ($totalDaily as $s => $c) $parts[] = "$s: $c";
            echo implode(', ', $parts) ?: 'none';
        ?>)
    </div>
    
    <h2>Hourly Usage (Current Hour)</h2>
    <table>
        <tr>
            <th>User ID</th>
            <th>Username</th>
            <?php foreach ($allServices as $service): ?>
            <th><?= htmlspecialchars($service) ?></th>
            <?php endforeach; ?>
            <th>Total</th>
            <th>Hour Reset</th>
        </tr>
        <?php foreach ($usageData as $row): ?>
        <tr class="<?= $row['hourly_expired'] ? 'expired' : '' ?>">
            <td><?= $row['user_id'] ?></td>
            <td><?= htmlspecialchars($userNames[$row['user_id']] ?? 'Unknown') ?></td>
            <?php foreach ($allServices as $service): ?>
            <td><?= $row['hourly'][$service] ?? 0 ?></td>
            <?php endforeach; ?>
            <td><strong><?= array_sum($row['hourly']) ?></strong></td>
            <td class="<?= $row['hourly_expired'] ? 'expired' : '' ?>">
                <?= date('Y-m-d H:i:s', $row['hour_reset']) ?>
            </td>
        </tr>
        <?php endforeach; ?>
    </table>
    
    <h2>Daily Usage (Audit)</h2>
    <table>
        <tr>
            <th>User ID</th>
            <th>Username</th>
            <?php foreach ($allServices as $service): ?>
            <th><?= htmlspecialchars($service) ?></th>
            <?php endforeach; ?>
            <th>Total</th>
            <th>Day Reset</th>
        </tr>
        <?php foreach ($usageData as $row): ?>
        <tr class="<?= $row['daily_expired'] ? 'expired' : '' ?>">
            <td><?= $row['user_id'] ?></td>
            <td><?= htmlspecialchars($userNames[$row['user_id']] ?? 'Unknown') ?></td>
            <?php foreach ($allServices as $service): ?>
            <td><?= $row['daily'][$service] ?? 0 ?></td>
            <?php endforeach; ?>
            <td><strong><?= array_sum($row['daily']) ?></strong></td>
            <td class="<?= $row['daily_expired'] ? 'expired' : '' ?>">
                <?= date('Y-m-d H:i:s', $row['day_reset']) ?>
            </td>
        </tr>
        <?php endforeach; ?>
    </table>
    
    <?php if (empty($usageData)): ?>
    <p>No usage data found.</p>
    <?php endif; ?>
</body>
</html>
