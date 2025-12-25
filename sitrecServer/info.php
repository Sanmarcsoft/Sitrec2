<?php
// SECURITY: Require admin access to view phpinfo
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

$userInfo = getUserInfo();
if (!in_array(3, $userInfo['user_groups'])) {
    http_response_code(403);
    die('Admin access required');
}

phpinfo();
?>
