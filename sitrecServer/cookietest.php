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

    $fileDir = '../../';  # relative path from this script to the Xenforo root
    require($fileDir . '/src/XF.php');
    XF::start($fileDir);
    $app = XF::setupApp('XF\Pub\App');
    $app->start();
    print_r (XF::visitor());  # dumps entire object
    $user=XF::visitor();

    print($user->username."<br>");

    exit(0);