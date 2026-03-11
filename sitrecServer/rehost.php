<?php
/*
 * Module: Sitrec upload/rehost API.
 *
 * Responsibilities:
 * - Handle authenticated user upload and deletion operations.
 * - Support filesystem uploads and S3 uploads (single-part and multipart).
 * - Mint presigned upload URLs and complete multipart uploads.
 * - Return stable object references (`sitrec://...`) alongside legacy direct URLs.
 * - Expose user capability/quota metadata via `getuser`.
 */
// need to modify php.ini?
// /opt/homebrew/etc/php/8.4/php.ini
// brew services restart php

// CRITICAL: Prevent caching of rehost.php responses
// Each upload is unique and must never return a cached result from a previous request
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');  // HTTP/1.0 compatibility
header('Expires: 0');        // For older browsers

require('./user.php');

$aws = null;

function startS3() {
    require 'vendor/autoload.php';
    global $aws;
    global $s3creds;

    $aws = $s3creds;

    // Get it into the right format
    $credentials = new Aws\Credentials\Credentials($aws['accessKeyId'], $aws['secretAccessKey']);

    // Create an S3 client
    $s3 = new Aws\S3\S3Client([
        'version' => 'latest',
        'region' => $aws['region'],
        'credentials' => $credentials
    ]);
    return $s3;
}

/**
 * Converts an object key to canonical Sitrec object-ref format.
 *
 * @param string $key
 * @return string
 */
function makeObjectRef($key) {
    return 'sitrec://' . $key;
}

/**
 * Reads a positive integer seconds value from environment with fallback.
 *
 * @param string $name Environment variable name.
 * @param int $default Fallback seconds value.
 * @return int
 */
function getEnvIntSeconds($name, $default) {
    $value = getenv($name);
    if ($value === false || $value === '') return $default;
    $intValue = intval($value);
    return $intValue > 0 ? $intValue : $default;
}

function getEnvString($name, $default = '') {
    $value = getenv($name);
    if ($value === false) return $default;
    $value = trim((string)$value);
    return $value === '' ? $default : $value;
}

function getEnvPrefixList($name) {
    $raw = getEnvString($name, '');
    if ($raw === '') return [];

    $parts = explode(',', $raw);
    $prefixes = [];
    foreach ($parts as $part) {
        $prefix = rawurldecode(trim($part));
        $prefix = ltrim($prefix, '/');
        if ($prefix === '') continue;
        $prefixes[] = $prefix;
    }
    return $prefixes;
}

function objectKeyMatchesPrefix($key, $prefix) {
    if ($prefix === '') return false;
    if (str_ends_with($prefix, '/')) {
        return str_starts_with($key, $prefix);
    }
    return $key === $prefix || str_starts_with($key, $prefix . '/');
}

function objectKeyMatchesAnyPrefix($key, $prefixes) {
    foreach ($prefixes as $prefix) {
        if (objectKeyMatchesPrefix($key, $prefix)) return true;
    }
    return false;
}

function isObjectKeyPublic($key) {
    $defaultVisibility = strtolower(getEnvString('S3_DEFAULT_VISIBILITY', 'public'));
    if ($defaultVisibility !== 'public' && $defaultVisibility !== 'private') {
        $defaultVisibility = 'public';
    }

    if ($defaultVisibility === 'public') {
        $privatePrefixes = getEnvPrefixList('S3_PRIVATE_PREFIXES');
        return !objectKeyMatchesAnyPrefix($key, $privatePrefixes);
    }

    $publicPrefixes = getEnvPrefixList('S3_PUBLIC_PREFIXES');
    return objectKeyMatchesAnyPrefix($key, $publicPrefixes);
}

function encodeObjectKeyForUrl($key) {
    $segments = explode('/', $key);
    $encoded = array_map(fn($segment) => rawurlencode($segment), $segments);
    return implode('/', $encoded);
}

function buildBucketS3ObjectUrl($key) {
    global $aws;
    return 'https://' . $aws['bucket'] . '.s3.' . $aws['region'] . '.amazonaws.com/' . encodeObjectKeyForUrl($key);
}

function buildPublicObjectUrl($key) {
    $publicBase = getEnvString('S3_PUBLIC_BASE_URL', '');
    if ($publicBase !== '') {
        return rtrim($publicBase, '/') . '/' . encodeObjectKeyForUrl($key);
    }
    return buildBucketS3ObjectUrl($key);
}

function buildObjectAccessUrl($key) {
    if (isObjectKeyPublic($key)) {
        return buildPublicObjectUrl($key);
    }
    return buildBucketS3ObjectUrl($key);
}

function getUploadAclForKey($key) {
    global $aws;
    $publicAcl = getEnvString('S3_PUBLIC_OBJECT_ACL', $aws['acl'] ?? 'public-read');
    $privateAcl = getEnvString('S3_PRIVATE_OBJECT_ACL', 'private');
    return isObjectKeyPublic($key) ? $publicAcl : $privateAcl;
}

function getGoogle3DRootDailyLimitForGroups($userGroups) {
    $dailyLimits = [
        3 => 1000000, // Admin: effectively unlimited
        14 => 30,     // Meta Members
        19 => 30,     // Sitrec Plus
    ];

    $limit = 0;
    foreach ($userGroups as $group) {
        if (isset($dailyLimits[$group])) {
            $limit = max($limit, $dailyLimits[$group]);
        }
    }
    return $limit;
}

function getCesiumOSM3DBytesDailyLimitForGroups($userGroups) {
    $dailyLimitBytes = intdiv(1024 * 1024 * 1024, 30); // 1 GiB / 30 days per day
    $dailyLimits = [
        3 => 1000000000000, // Admin: effectively unlimited
        14 => $dailyLimitBytes,
        19 => $dailyLimitBytes,
    ];

    $limit = 0;
    foreach ($userGroups as $group) {
        if (isset($dailyLimits[$group])) {
            $limit = max($limit, $dailyLimits[$group]);
        }
    }
    return $limit;
}

function getTileServiceDailyUsage($userId, $service) {
    $usageDir = sys_get_temp_dir() . '/sitrec_tile_usage/';
    $file = $usageDir . "user_{$userId}.json";
    if (!file_exists($file)) {
        return 0;
    }

    $data = json_decode(file_get_contents($file), true);
    if (!$data) {
        return 0;
    }

    $now = time();
    if ($now > ($data['dayReset'] ?? 0)) {
        return 0;
    }

    return max(0, intval($data['daily'][$service] ?? 0));
}

// if we were passed the parameter "getuser", then we return user data as JSON
if (isset($_GET['getuser'])) {
    header('Content-Type: application/json');

    // Avoid double auth initialization by resolving identity once on this path.
    $userInfo = getUserInfo();
    $user_id = $userInfo['user_id'] ?? 0;
    $userGroups = is_array($userInfo['user_groups'] ?? null) ? $userInfo['user_groups'] : [];
    $allowed3DBuildingGroups = [3, 14, 19]; // Admin, Sitrec Members, Sitrec Plus
    $has3DBuildingGroup = count(array_intersect($userGroups, $allowed3DBuildingGroups)) > 0;

    $response = [
        'userID' => $user_id,
        'userGroups' => $userGroups,
        'canUse3DBuildings' => false,
    ];

    $googleRootLimit = getGoogle3DRootDailyLimitForGroups($userGroups);
    $googleRootUsed = getTileServiceDailyUsage($user_id, 'google_3d_root');
    $googleRootRemaining = max(0, $googleRootLimit - $googleRootUsed);
    $response['google3DRootDailyLimit'] = $googleRootLimit;
    $response['google3DRootDailyRemaining'] = $googleRootRemaining;

    $cesiumBytesLimit = getCesiumOSM3DBytesDailyLimitForGroups($userGroups);
    $cesiumBytesUsed = getTileServiceDailyUsage($user_id, 'cesium_osm_3d_bytes');
    $cesiumBytesRemaining = max(0, $cesiumBytesLimit - $cesiumBytesUsed);
    $response['cesium3DBytesDailyLimit'] = $cesiumBytesLimit;
    $response['cesium3DBytesDailyRemaining'] = $cesiumBytesRemaining;

    // Include 3D buildings API keys only for allowed groups (or localhost).
    $isLocalhost = ($_SERVER['REMOTE_ADDR'] === '127.0.0.1' ||
                    $_SERVER['REMOTE_ADDR'] === '::1');
    if ($has3DBuildingGroup || $isLocalhost) {
        $googleKey = getenv('GOOGLE_MAPS_API_KEY');
        $cesiumToken = getenv('CESIUM_ION_TOKEN');
        $googleAllowedByQuota = $isLocalhost || $googleRootRemaining > 0;
        $cesiumAllowedByQuota = $isLocalhost || $cesiumBytesRemaining > 0;
        if ($googleKey && $googleAllowedByQuota) $response['GOOGLE_MAPS_API_KEY'] = $googleKey;
        if ($cesiumToken && $cesiumAllowedByQuota) $response['CESIUM_ION_TOKEN'] = $cesiumToken;
        $response['canUse3DBuildings'] = true;
    }

    echo json_encode($response);
    exit();
}

$user_id = getUserID();
$userDir = getUserDir($user_id);

// need to be logged in, and a member of group 9 (Verified users)
if ($user_id == 0 /*|| !in_array(9,$user->secondary_group_ids)*/) {
    http_response_code(501);
    exit("Internal Server Error");
}

if (isset($_GET['action']) && $_GET['action'] === 'getPresignedUrl') {
    header('Content-Type: application/json');
    
    $input = file_get_contents('php://input');
    $requestData = json_decode($input, true);
    
    if (!isset($requestData['filename'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Filename not provided']);
        exit();
    }
    
    $fileName = basename($requestData['filename']);
    $version = isset($requestData['version']) ? basename($requestData['version']) : null;
    $contentHash = isset($requestData['contentHash']) ? $requestData['contentHash'] : null;
    
    $fileName = preg_replace('/[^\w\s\.\-\(\),]/', '_', $fileName);
    
    if (!isSafeName($fileName) || !isSafeExtension($fileName) ||
        ($version && (!isSafeName($version) || !isSafeExtension($version)))) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid filename, version, or file type']);
        exit();
    }
    
    if ($contentHash && !preg_match('/^[a-f0-9]+$/', $contentHash)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid content hash']);
        exit();
    }
    
    if (!$useAWS) {
        http_response_code(400);
        echo json_encode(['error' => 'S3 not enabled']);
        exit();
    }
    
    $s3 = startS3();
    
    $extension = pathinfo($fileName, PATHINFO_EXTENSION);
    $baseName = pathinfo($fileName, PATHINFO_FILENAME);
    
    if ($version) {
        $newFileName = $version;
    } else {
        $uniqueId = $contentHash ? $contentHash : uniqid();
        $newFileName = $baseName . '-' . $uniqueId . '.' . $extension;
    }
    
    $s3Path = $user_id . '/' . $newFileName;
    if ($version) {
        $s3Path = $user_id . '/' . $fileName . '/' . $newFileName;
    }
    
    if ($contentHash) {
        try {
            $s3->headObject([
                'Bucket' => $aws['bucket'],
                'Key' => $s3Path
            ]);
            $objectUrl = buildObjectAccessUrl($s3Path);
            echo json_encode([
                'exists' => true,
                'objectRef' => makeObjectRef($s3Path),
                'objectUrl' => $objectUrl
            ]);
            exit();
        } catch (Aws\S3\Exception\S3Exception $e) {
        }
    }
    
    try {
        $uploadAcl = getUploadAclForKey($s3Path);
        $cmd = $s3->getCommand('PutObject', [
            'Bucket' => $aws['bucket'],
            'Key' => $s3Path,
            'ACL' => $uploadAcl
        ]);
        
        $putExpirySeconds = getEnvIntSeconds('S3_PRESIGNED_PUT_EXPIRY_SECONDS', 900);
        $request = $s3->createPresignedRequest($cmd, '+' . $putExpirySeconds . ' seconds');
        
        $presignedUrl = (string) $request->getUri();
        
        $objectUrl = buildObjectAccessUrl($s3Path);
        
        echo json_encode([
            'objectRef' => makeObjectRef($s3Path),
            'presignedUrl' => $presignedUrl,
            'objectUrl' => $objectUrl
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to generate presigned URL: ' . $e->getMessage()]);
    }
    
    exit();
}

if (isset($_GET['action']) && $_GET['action'] === 'initiateMultipart') {
    header('Content-Type: application/json');
    
    $input = file_get_contents('php://input');
    $requestData = json_decode($input, true);
    
    if (!isset($requestData['filename']) || !isset($requestData['parts'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Filename and parts count required']);
        exit();
    }
    
    $fileName = basename($requestData['filename']);
    $version = isset($requestData['version']) ? basename($requestData['version']) : null;
    $contentHash = isset($requestData['contentHash']) ? $requestData['contentHash'] : null;
    $totalParts = (int)$requestData['parts'];
    
    $fileName = preg_replace('/[^\w\s\.\-\(\),]/', '_', $fileName);
    
    if (!isSafeName($fileName) || !isSafeExtension($fileName) ||
        ($version && (!isSafeName($version) || !isSafeExtension($version)))) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid filename, version, or file type']);
        exit();
    }
    
    if ($contentHash && !preg_match('/^[a-f0-9]+$/', $contentHash)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid content hash']);
        exit();
    }
    
    if (!$useAWS) {
        http_response_code(400);
        echo json_encode(['error' => 'S3 not enabled']);
        exit();
    }
    
    $s3 = startS3();
    
    $extension = pathinfo($fileName, PATHINFO_EXTENSION);
    $baseName = pathinfo($fileName, PATHINFO_FILENAME);
    
    if ($version) {
        $newFileName = $version;
    } else {
        $uniqueId = $contentHash ? $contentHash : uniqid();
        $newFileName = $baseName . '-' . $uniqueId . '.' . $extension;
    }
    
    $s3Path = $user_id . '/' . $newFileName;
    if ($version) {
        $s3Path = $user_id . '/' . $fileName . '/' . $newFileName;
    }
    
    if ($contentHash) {
        try {
            $s3->headObject([
                'Bucket' => $aws['bucket'],
                'Key' => $s3Path
            ]);
            $objectUrl = buildObjectAccessUrl($s3Path);
            echo json_encode([
                'exists' => true,
                'objectRef' => makeObjectRef($s3Path),
                'objectUrl' => $objectUrl
            ]);
            exit();
        } catch (Aws\S3\Exception\S3Exception $e) {
        }
    }
    
    try {
        $uploadAcl = getUploadAclForKey($s3Path);
        $result = $s3->createMultipartUpload([
            'Bucket' => $aws['bucket'],
            'Key' => $s3Path,
            'ACL' => $uploadAcl
        ]);
        
        $uploadId = $result['UploadId'];
        
        $uploadUrls = [];
        for ($partNumber = 1; $partNumber <= $totalParts; $partNumber++) {
            $cmd = $s3->getCommand('UploadPart', [
                'Bucket' => $aws['bucket'],
                'Key' => $s3Path,
                'UploadId' => $uploadId,
                'PartNumber' => $partNumber
            ]);
            
            $multipartExpirySeconds = getEnvIntSeconds('S3_PRESIGNED_MULTIPART_EXPIRY_SECONDS', 3600);
            $request = $s3->createPresignedRequest($cmd, '+' . $multipartExpirySeconds . ' seconds');
            $uploadUrls[] = (string) $request->getUri();
        }
        
        $objectUrl = buildObjectAccessUrl($s3Path);
        
        echo json_encode([
            'uploadId' => $uploadId,
            'uploadUrls' => $uploadUrls,
            'objectRef' => makeObjectRef($s3Path),
            'objectUrl' => $objectUrl
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to initiate multipart upload: ' . $e->getMessage()]);
    }
    
    exit();
}

if (isset($_GET['action']) && $_GET['action'] === 'completeMultipart') {
    header('Content-Type: application/json');
    
    $input = file_get_contents('php://input');
    $requestData = json_decode($input, true);
    
    if (!isset($requestData['filename']) || !isset($requestData['uploadId']) || !isset($requestData['parts'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Filename, uploadId, and parts required']);
        exit();
    }
    
    $fileName = basename($requestData['filename']);
    $version = isset($requestData['version']) ? basename($requestData['version']) : null;
    $uploadId = $requestData['uploadId'];
    $parts = $requestData['parts'];
    
    $fileName = preg_replace('/[^\w\s\.\-\(\),]/', '_', $fileName);
    
    if (!isSafeName($fileName) || !isSafeExtension($fileName) ||
        ($version && (!isSafeName($version) || !isSafeExtension($version)))) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid filename, version, or file type']);
        exit();
    }
    
    if (!$useAWS) {
        http_response_code(400);
        echo json_encode(['error' => 'S3 not enabled']);
        exit();
    }
    
    $s3 = startS3();
    
    try {
        $multipartUploads = $s3->listMultipartUploads([
            'Bucket' => $aws['bucket'],
            'Prefix' => $user_id . '/'
        ]);
        
        $s3Path = null;
        foreach ($multipartUploads['Uploads'] as $upload) {
            if ($upload['UploadId'] === $uploadId) {
                $s3Path = $upload['Key'];
                break;
            }
        }
        
        if (!$s3Path) {
            http_response_code(400);
            echo json_encode(['error' => 'Upload ID not found or expired']);
            exit();
        }
        
        $result = $s3->completeMultipartUpload([
            'Bucket' => $aws['bucket'],
            'Key' => $s3Path,
            'UploadId' => $uploadId,
            'MultipartUpload' => [
                'Parts' => $parts
            ]
        ]);
        
        $objectUrl = buildObjectAccessUrl($s3Path);
        
        echo json_encode([
            'objectRef' => makeObjectRef($s3Path),
            'objectUrl' => $objectUrl,
            'eTag' => $result['ETag']
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to complete multipart upload: ' . $e->getMessage()]);
    }
    
    exit();
}

$isLocal = false;

//if ($_SERVER['HTTP_HOST'] === 'localhost' || $_SERVER['SERVER_NAME'] === 'localhost') {
//    // for local testing
//    $storagePath = $ROOT_URL . "sitrec-upload/";
//    $isLocal = true;
//} else {
$storagePath = $UPLOAD_URL;  // from config.php
//}

function writeLog($message) {
//    global $logPath;
//    // Ensure message is a string
//    if (!is_string($message)) {
//        $message = print_r($message, true);
//    }
//
//    // Add a timestamp to each log entry for easier tracking
//    $timestamp = date("Y-m-d H:i:s");
//    $logEntry = "[$timestamp] " . $message . "\n";
//
//    // Append the log entry to the log file
//    file_put_contents($logPath, $logEntry, FILE_APPEND);
}

// Secure validation function
function isSafeName($name) {
    // Check if the name contains only allowed characters
    // which are A-Z, a-z, 0-9, space, _, -, ., (, ), ,
    return preg_match('/^[A-Za-z0-9 _\\-\\.\\(\\),]+$/', $name);
}

// Extensions that must never be stored — server-side executables and config overrides
function isSafeExtension($filename) {
    static $DANGEROUS_EXTENSIONS = [
        'php', 'php3', 'php4', 'php5', 'php7', 'phtml', 'phar',
        'shtml', 'shtm', 'cgi', 'pl', 'py', 'rb', 'sh', 'bash',
        'asp', 'aspx', 'jsp', 'cfm', 'htaccess', 'htpasswd'
    ];
    $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    return !in_array($ext, $DANGEROUS_EXTENSIONS, true);
}

// check to see if we have delete = true
if (isset($_POST['delete']) && $_POST['delete'] == 'true') {
    $filename = $_POST['filename'] ?? '';
    $version = $_POST['version'] ?? null;

    // Strictly validate filename and version
    if (!isSafeName($filename) || ($version && !isSafeName($version))) {
        // exit with error code
        http_response_code(400);
        exit("Invalid filename or version");
    }

    if ($useAWS) {
        // delete the entire folder from s3
        require 'vendor/autoload.php';
        $s3 = startS3();
    }

    // if no version name is supplied, then we delete the entire folder
    if (!$version) {
        if ($useAWS) {
            $s3Path = $user_id . '/' . $filename . '/';
            $s3->deleteMatchingObjects($aws['bucket'], $s3Path);
        } else {
            $dir = $userDir . basename($filename);
            if (file_exists($dir)) {
                $files = glob($dir . '/*'); // get all file names
                foreach ($files as $file) { // iterate files
                    if (is_file($file)) {
                        unlink($file); // delete file
                    }
                }
                rmdir($dir);
            }
        }
    } else {
        if ($useAWS) {
            // delete the specific version from s3
            $s3Path = $user_id . '/' . $filename . '/' . $version;
            $s3->deleteMatchingObjects($aws['bucket'], $s3Path);
        } else {
            $file = $userDir . basename($filename) . '/' . basename($version);
            if (file_exists($file)) {
                unlink($file);
            }
        }
    }
    exit(0);
}

// Check if file and filename are provided
if (!isset($_FILES['fileContent']) || !isset($_POST['filename'])) {
    die("File or filename not provided");
}

// Securely retrieve the file and filename
$fileName = basename($_POST['filename']);
$fileContent = file_get_contents($_FILES['fileContent']['tmp_name']);
$version = isset($_POST['version']) ? basename($_POST['version']) : null;

// sanitize the filename by removing any path components
// or any characters that are not alphanumeric, space, _, -, ., (, )
$fileName = preg_replace('/[^\w\s\.\-\(\),]/', '_', $fileName);


// Validate names and extensions
if (!isSafeName($fileName) || !isSafeExtension($fileName) ||
    ($version && (!isSafeName($version) || !isSafeExtension($version)))) {
    http_response_code(400);
    echo("Invalid filename, version, or file type provided " . $fileName);
    exit("Invalid filename, version, or file type provided");
}

writeLog(print_r($_FILES, true));
writeLog(print_r($_POST, true));

// Create a filename with MD5 checksum of the contents of the file
$md5Checksum = md5($fileContent);

// Separate the filename and extension
$extension = pathinfo($fileName, PATHINFO_EXTENSION);
$baseName = pathinfo($fileName, PATHINFO_FILENAME);

// Append MD5 checksum before the extension
$newFileName = $baseName . '-' . $md5Checksum . '.' . $extension;

if ($version) {
    // versioned files sit in a folder based on the file name
    // like /sitrec-upload/99999998/MyFile/versionnumber.jpg
    $userDir = $userDir . $baseName . '/';
    $newFileName = $version;  // Assume front-end has supplied a unique version number with correct extension
}

if ($useAWS) {
    $s3 = startS3();

    $filePath = $_FILES['fileContent']['tmp_name'];
    $fileStream = fopen($filePath, 'r');

    $s3Path = $user_id . '/' . $newFileName;
    if ($version) {
        $s3Path = $user_id . '/' . $fileName . '/' . $newFileName;
    }

    // Upload the file using the high-level upload method
    // Using upload instead of putObject to allow for larger files
    // putObject was giving odd timeout errors.
    try {
        $uploadAcl = getUploadAclForKey($s3Path);
        $s3->upload($aws['bucket'], $s3Path, $fileStream, $uploadAcl);
        echo buildObjectAccessUrl($s3Path);
    } catch (Aws\Exception\S3Exception $e) {
        // Catch an S3 specific exception.
        http_response_code(555);
        exit("Internal Server Error: " . $e->getMessage());
    } finally {
        if (is_resource($fileStream)) {
            fclose($fileStream);  // Close the file stream to free up resources
        }
    }
    exit(0);
}

// Local server storage
if (!file_exists($userDir)) {
    mkdir($userDir, 0755, true);
}

$userFilePath = $userDir . $newFileName;


// Move the file to the user's directory
if (!file_exists($userFilePath)) {
    move_uploaded_file($_FILES['fileContent']['tmp_name'], $userFilePath);
}

// Return the URL of the rehosted file
if ($version) {
    echo $storagePath . $user_id . '/' . $fileName . '/' . $newFileName;
} else {
    echo $storagePath . $user_id . '/' . $newFileName;
}
?>
