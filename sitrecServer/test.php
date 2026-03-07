<?php
// SECURITY: Require admin access for debug endpoints
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

$userInfo = getUserInfo();
if (!isAdmin($userInfo)) {
    http_response_code(403);
    die('Admin access required');
}

print_r($_COOKIE);
