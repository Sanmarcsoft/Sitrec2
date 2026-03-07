<?php
/**
 * User Metadata API
 *
 * Handles loading and saving user metadata (label definitions + sitch-label mappings).
 * Storage mirrors settings.php pattern:
 *   - S3: metadata/<userID>.json
 *   - Local: $UPLOAD_PATH/metadata/<userID>.json
 *
 * Per-sitch metadata is also written to <userID>/<sitchName>/metadata.json
 * when labels are assigned.
 *
 * GET: Returns user metadata {labels: [...], sitchLabels: {...}}
 * POST: Saves user metadata. If "updateSitch" is provided, also writes per-sitch metadata.json
 */

require('./user.php');

header('Content-Type: application/json');

$user_id = getUserID();

if ($user_id == 0) {
    http_response_code(401);
    echo json_encode(['error' => 'Not logged in']);
    exit();
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';

define('MAX_LABELS', 100);
define('MAX_LABEL_NAME_LENGTH', 50);
define('MAX_SITCHES_WITH_LABELS', 10000);
define('SITCH_NAME_PATTERN', '/^(?!\.{1,2}$)[^\/\\\\<>\x00-\x1f]+$/u');

function isValidSitchName($name) {
    return is_string($name) && preg_match(SITCH_NAME_PATTERN, $name) === 1;
}

/**
 * Sanitize user metadata to prevent exploits.
 */
function sanitizeMetadata($data) {
    $sanitized = ['labels' => [], 'sitchLabels' => []];

    // Sanitize label definitions
    if (isset($data['labels']) && is_array($data['labels'])) {
        $count = 0;
        foreach ($data['labels'] as $label) {
            if ($count >= MAX_LABELS) break;
            if (!is_array($label) || !isset($label['name'])) continue;

            $name = substr(trim(strval($label['name'])), 0, MAX_LABEL_NAME_LENGTH);
            if ($name === '') continue;

            // Validate color (hex format)
            $color = '#4285f4'; // default blue
            if (isset($label['color']) && preg_match('/^#[0-9a-fA-F]{6}$/', $label['color'])) {
                $color = $label['color'];
            }

            $sanitized['labels'][] = ['name' => $name, 'color' => $color];
            $count++;
        }
    }

    // Sanitize sitch-label mappings
    if (isset($data['sitchLabels']) && is_array($data['sitchLabels'])) {
        $count = 0;
        foreach ($data['sitchLabels'] as $sitchName => $labels) {
            if ($count >= MAX_SITCHES_WITH_LABELS) break;
            if (!is_string($sitchName) || !is_array($labels)) continue;

            // Normalize then validate to block traversal-like names (e.g. "."/"..")
            $sitchName = basename($sitchName);
            if (!isValidSitchName($sitchName)) continue;

            $cleanLabels = [];
            foreach ($labels as $lbl) {
                $lbl = substr(trim(strval($lbl)), 0, MAX_LABEL_NAME_LENGTH);
                if ($lbl !== '') $cleanLabels[] = $lbl;
            }
            if (!empty($cleanLabels)) {
                $sanitized['sitchLabels'][$sitchName] = $cleanLabels;
            }
            $count++;
        }
    }

    return $sanitized;
}

// --- S3 helpers (same pattern as settings.php) ---

function startS3() {
    require 'vendor/autoload.php';
    global $s3creds;
    if (!isset($s3creds) || !is_array($s3creds) || empty($s3creds['accessKeyId']) || $s3creds['accessKeyId'] === 0) {
        http_response_code(503);
        echo json_encode(['error' => 'S3 credentials not configured']);
        exit();
    }
    $aws = $s3creds;
    $credentials = new Aws\Credentials\Credentials($aws['accessKeyId'], $aws['secretAccessKey']);
    $s3 = new Aws\S3\S3Client([
        'version' => 'latest',
        'region' => $aws['region'],
        'credentials' => $credentials
    ]);
    return ['s3' => $s3, 'aws' => $aws];
}

function readS3Json($s3, $aws, $key) {
    try {
        $result = $s3->getObject(['Bucket' => $aws['bucket'], 'Key' => $key]);
        $data = json_decode($result['Body']->getContents(), true);
        return is_array($data) ? $data : [];
    } catch (Aws\S3\Exception\S3Exception $e) {
        if ($e->getAwsErrorCode() === 'NoSuchKey') return [];
        throw $e;
    }
}

function writeS3Json($s3, $aws, $key, $data) {
    $s3->putObject([
        'Bucket' => $aws['bucket'],
        'Key' => $key,
        'Body' => json_encode($data, JSON_PRETTY_PRINT),
        'ContentType' => 'application/json',
        'ACL' => 'private'
    ]);
}

// --- Local filesystem helpers ---

function readLocalJson($path) {
    if (!is_file($path)) return [];
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : [];
}

function writeLocalJson($path, $data) {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT));
}

// ============================
// Handle GET - Fetch metadata
// ============================
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        global $useAWS;
        if ($useAWS) {
            $s3Data = startS3();
            $key = 'metadata/' . $user_id . '.json';
            $raw = readS3Json($s3Data['s3'], $s3Data['aws'], $key);
        } else {
            global $UPLOAD_PATH;
            $path = $UPLOAD_PATH . 'metadata/' . $user_id . '.json';
            $raw = readLocalJson($path);
        }
        $sanitized = sanitizeMetadata($raw);
        echo json_encode($sanitized);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Server error: ' . $e->getMessage()]);
    }
    exit();
}

// ============================
// Handle POST - Save metadata
// ============================
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['error' => 'Invalid JSON']);
            exit();
        }

        $sanitized = sanitizeMetadata($input);

        global $useAWS;
        if ($useAWS) {
            $s3Data = startS3();
            $s3 = $s3Data['s3'];
            $aws = $s3Data['aws'];

            // Save user-level metadata
            writeS3Json($s3, $aws, 'metadata/' . $user_id . '.json', $sanitized);

            // If updateSitch is specified, write per-sitch metadata.json
            if (isset($input['updateSitch']) && is_string($input['updateSitch'])) {
                $sitchName = basename($input['updateSitch']);
                if (isValidSitchName($sitchName)) {
                    $sitchLabels = $sanitized['sitchLabels'][$sitchName] ?? [];
                    $sitchKey = $user_id . '/' . $sitchName . '/metadata.json';
                    writeS3Json($s3, $aws, $sitchKey, ['labels' => $sitchLabels]);
                }
            }
        } else {
            global $UPLOAD_PATH;

            // Save user-level metadata
            $metaPath = $UPLOAD_PATH . 'metadata/' . $user_id . '.json';
            writeLocalJson($metaPath, $sanitized);

            // If updateSitch is specified, write per-sitch metadata.json
            if (isset($input['updateSitch']) && is_string($input['updateSitch'])) {
                $sitchName = basename($input['updateSitch']);
                if (isValidSitchName($sitchName)) {
                    $sitchLabels = $sanitized['sitchLabels'][$sitchName] ?? [];
                    $sitchPath = $UPLOAD_PATH . $user_id . '/' . $sitchName . '/metadata.json';
                    writeLocalJson($sitchPath, ['labels' => $sitchLabels]);
                }
            }
        }

        echo json_encode(['success' => true, 'metadata' => $sanitized]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Server error: ' . $e->getMessage()]);
    }
    exit();
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
?>
