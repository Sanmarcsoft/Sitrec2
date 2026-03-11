<?php

/*
 * Module: Sitrec object resolver endpoint.
 *
 * Responsibilities:
 * - Accept object references in canonical, raw-key, or legacy S3 URL forms.
 * - Normalize and validate references into internal object keys.
 * - Resolve folder references to the latest versioned `.js` file.
 * - Return canonical ref metadata and a concrete fetch URL.
 * - Generate presigned GET URLs in AWS mode (or direct local URLs in filesystem mode).
 */

header('Content-Type: application/json');

$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin) {
    $serverOrigin = $_SERVER['REQUEST_SCHEME'] . '://' . $_SERVER['HTTP_HOST'];
    $allowedOrigins = [$serverOrigin];
    $localhostEnv = getenv('LOCALHOST');
    if ($localhostEnv) {
        $allowedOrigins[] = 'https://' . $localhostEnv;
        $allowedOrigins[] = 'http://' . $localhostEnv;
    }
    if (in_array($requestOrigin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $requestOrigin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';

define('SITREC_REF_PREFIX', 'sitrec://');

/**
 * Reads an integer seconds value from environment with fallback validation.
 *
 * @param string $name Environment variable name.
 * @param int $default Fallback value when env var is missing/empty/invalid.
 * @return int Positive integer number of seconds.
 */
function getEnvIntSeconds($name, $default) {
    $value = getenv($name);
    if ($value === false || $value === '') return $default;
    $intValue = intval($value);
    return $intValue > 0 ? $intValue : $default;
}

/**
 * Reads a string environment variable with fallback.
 *
 * @param string $name
 * @param string $default
 * @return string
 */
function getEnvString($name, $default = '') {
    $value = getenv($name);
    if ($value === false) return $default;
    $value = trim((string)$value);
    return $value === '' ? $default : $value;
}

/**
 * Parses a comma-separated environment variable into normalized object-key prefixes.
 *
 * Prefix examples:
 * - `1/private/`
 * - `private/`
 * - `12345/My Sitch`
 *
 * @param string $name
 * @return array<int,string>
 */
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

/**
 * Checks whether an object key matches a configured prefix.
 *
 * A prefix without trailing `/` matches either exact key or descendant path.
 *
 * @param string $key
 * @param string $prefix
 * @return bool
 */
function objectKeyMatchesPrefix($key, $prefix) {
    if ($prefix === '') return false;
    if (str_ends_with($prefix, '/')) {
        return str_starts_with($key, $prefix);
    }
    return $key === $prefix || str_starts_with($key, $prefix . '/');
}

/**
 * Checks whether an object key matches any prefix in a list.
 *
 * @param string $key
 * @param array<int,string> $prefixes
 * @return bool
 */
function objectKeyMatchesAnyPrefix($key, $prefixes) {
    foreach ($prefixes as $prefix) {
        if (objectKeyMatchesPrefix($key, $prefix)) {
            return true;
        }
    }
    return false;
}

/**
 * Determines whether a key should be treated as public for read resolution.
 *
 * Policy:
 * - `S3_DEFAULT_VISIBILITY=public|private` (default: `public`)
 * - `S3_PRIVATE_PREFIXES` applies when default is `public`
 * - `S3_PUBLIC_PREFIXES` applies when default is `private`
 *
 * @param string $key
 * @return bool
 */
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

/**
 * Sends a JSON error response and terminates execution.
 *
 * @param int $status HTTP status code.
 * @param string $message Error message.
 * @return void
 */
function jsonError($status, $message) {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit();
}

/**
 * URL-encodes each path segment of an object key while preserving `/` separators.
 *
 * @param string $key
 * @return string
 */
function encodeObjectKeyForUrl($key) {
    $segments = explode('/', $key);
    $encoded = array_map(fn($segment) => rawurlencode($segment), $segments);
    return implode('/', $encoded);
}

/**
 * Builds a direct local-storage URL for an object key (non-AWS mode).
 *
 * @param string $key
 * @return string
 */
function buildLocalObjectUrl($key) {
    global $UPLOAD_URL;
    return rtrim($UPLOAD_URL, '/') . '/' . encodeObjectKeyForUrl($key);
}

/**
 * Builds the canonical S3 bucket URL for an object key.
 *
 * @param string $key
 * @return string
 */
function buildDefaultS3ObjectUrl($key) {
    global $s3creds;
    return 'https://' . $s3creds['bucket'] . '.s3.' . $s3creds['region'] . '.amazonaws.com/' . encodeObjectKeyForUrl($key);
}

/**
 * Builds a public unsigned URL for an object key.
 *
 * If `S3_PUBLIC_BASE_URL` is set, that base is used (e.g. CloudFront/custom CDN domain).
 * Otherwise falls back to bucket virtual-hosted S3 URL.
 *
 * @param string $key
 * @return string
 */
function buildPublicObjectUrl($key) {
    $publicBase = getEnvString('S3_PUBLIC_BASE_URL', '');
    if ($publicBase !== '') {
        return rtrim($publicBase, '/') . '/' . encodeObjectKeyForUrl($key);
    }
    return buildDefaultS3ObjectUrl($key);
}

/**
 * Converts an object key to canonical Sitrec ref format.
 *
 * @param string $key
 * @return string
 */
function canonicalObjectRef($key) {
    return SITREC_REF_PREFIX . $key;
}

/**
 * Attempts to parse a Sitrec object key from a legacy S3 URL.
 *
 * Supports:
 * - Virtual-hosted style: `https://bucket.s3.region.amazonaws.com/<key>`
 * - Path style: `https://s3.region.amazonaws.com/bucket/<key>`
 *
 * Only returns keys matching `<numericUserId>/...`.
 *
 * @param string $ref
 * @return string|null
 */
function parseLegacyS3Key($ref) {
    $parts = @parse_url($ref);
    if (!$parts || empty($parts['host'])) return null;

    $host = strtolower($parts['host']);
    $path = rawurldecode($parts['path'] ?? '');
    $isS3Host = strpos($host, '.s3.') !== false || $host === 's3.amazonaws.com' || str_starts_with($host, 's3.');
    if (!$isS3Host) return null;

    // Virtual-hosted style: https://bucket.s3.region.amazonaws.com/key
    if (preg_match('#^/\d+/.+#', $path)) {
        return ltrim($path, '/');
    }

    // Path style: https://s3.region.amazonaws.com/bucket/key
    if (preg_match('#^/[^/]+/(\d+/.+)$#', $path, $matches)) {
        return $matches[1];
    }

    return null;
}

/**
 * Normalizes user-supplied `ref` values into a validated Sitrec object key.
 *
 * Accepted input forms:
 * - `sitrec://<key>`
 * - raw key `<userId>/...`
 * - legacy S3 URL containing such a key
 *
 * Validation rejects:
 * - empty values
 * - control chars/backslashes
 * - path traversal segments (`.`/`..`)
 * - keys that do not start with numeric user id
 *
 * @param string $ref
 * @return string|null Normalized decoded key, or null when invalid.
 */
function normalizeRequestedRef($ref) {
    $ref = trim((string)$ref);
    if ($ref === '') return null;

    if (str_starts_with($ref, SITREC_REF_PREFIX)) {
        $key = substr($ref, strlen(SITREC_REF_PREFIX));
    } else {
        $legacyKey = parseLegacyS3Key($ref);
        $key = $legacyKey !== null ? $legacyKey : $ref;
    }

    $key = rawurldecode($key);
    $key = ltrim($key, '/');

    if ($key === '') return null;
    if (preg_match('/[\x00-\x1f\\\\]/', $key)) return null;
    if (preg_match('#(^|/)\.\.?(/|$)#', $key)) return null;
    if (!preg_match('#^\d+/.+#', $key)) return null;

    return $key;
}

/**
 * Resolves a folder key to the latest `.js` object in that folder.
 *
 * "Latest" is determined lexicographically by filename, matching existing version naming.
 * Works in both local filesystem and AWS S3 modes.
 *
 * @param string $folderKey Key with or without trailing slash.
 * @return string|null Full key including filename, or null when no matching versions exist.
 */
function resolveLatestObjectKey($folderKey) {
    global $useAWS, $UPLOAD_PATH, $s3creds;

    $latestFile = null;
    $folderKey = rtrim($folderKey, '/') . '/';

    if (!$useAWS) {
        $localDir = rtrim($UPLOAD_PATH, '/') . '/' . $folderKey;
        if (!is_dir($localDir)) {
            return null;
        }

        $files = scandir($localDir);
        foreach ($files as $file) {
            if (is_file($localDir . $file) && preg_match('/\.js$/', $file)) {
                if ($latestFile === null || strcmp($file, $latestFile) > 0) {
                    $latestFile = $file;
                }
            }
        }
        return $latestFile ? $folderKey . $latestFile : null;
    }

    require_once __DIR__ . '/vendor/autoload.php';
    $credentials = new Aws\Credentials\Credentials($s3creds['accessKeyId'], $s3creds['secretAccessKey']);
    $s3 = new Aws\S3\S3Client([
        'version' => 'latest',
        'region' => $s3creds['region'],
        'credentials' => $credentials
    ]);

    $objects = $s3->getIterator('ListObjects', [
        'Bucket' => $s3creds['bucket'],
        'Prefix' => $folderKey
    ]);

    foreach ($objects as $object) {
        $candidate = $object['Key'];
        if (!str_starts_with($candidate, $folderKey)) continue;
        $filename = substr($candidate, strlen($folderKey));
        if ($filename === '' || strpos($filename, '/') !== false) continue;
        if (!preg_match('/\.js$/', $filename)) continue;
        if ($latestFile === null || strcmp($filename, $latestFile) > 0) {
            $latestFile = $filename;
        }
    }

    return $latestFile ? $folderKey . $latestFile : null;
}

/**
 * Builds a fetchable URL for a resolved object key.
 *
 * Local mode: returns direct local object URL and no expiry.
 * AWS mode:
 * - public objects return stable unsigned URLs for cache reuse
 * - private objects return presigned GET URLs with expiry
 *
 * @param string $key
 * @return array{url:string,expiresAt:int|null}
 */
function buildResolvedObjectUrl($key) {
    global $useAWS, $s3creds;

    if (!$useAWS) {
        return [
            'url' => buildLocalObjectUrl($key),
            'expiresAt' => null
        ];
    }

    if (isObjectKeyPublic($key)) {
        return [
            'url' => buildPublicObjectUrl($key),
            'expiresAt' => null
        ];
    }

    require_once __DIR__ . '/vendor/autoload.php';
    $credentials = new Aws\Credentials\Credentials($s3creds['accessKeyId'], $s3creds['secretAccessKey']);
    $s3 = new Aws\S3\S3Client([
        'version' => 'latest',
        'region' => $s3creds['region'],
        'credentials' => $credentials
    ]);

    $cmd = $s3->getCommand('GetObject', [
        'Bucket' => $s3creds['bucket'],
        'Key' => $key
    ]);
    $expirySeconds = getEnvIntSeconds('S3_PRESIGNED_GET_EXPIRY_SECONDS', 1800);
    $request = $s3->createPresignedRequest($cmd, '+' . $expirySeconds . ' seconds');

    return [
        'url' => (string)$request->getUri(),
        'expiresAt' => time() + $expirySeconds
    ];
}

if (!isset($_GET['ref'])) {
    jsonError(400, 'Missing ref parameter');
}

$resolvedKey = normalizeRequestedRef($_GET['ref']);
if ($resolvedKey === null) {
    jsonError(400, 'Invalid ref parameter');
}

if (str_ends_with($resolvedKey, '/')) {
    $latestKey = resolveLatestObjectKey($resolvedKey);
    if ($latestKey === null) {
        jsonError(404, 'No versions found for folder');
    }
    $resolvedKey = $latestKey;
}

$result = buildResolvedObjectUrl($resolvedKey);

echo json_encode([
    'ref' => canonicalObjectRef($resolvedKey),
    'key' => $resolvedKey,
    'shareValue' => $resolvedKey,
    'url' => $result['url'],
    'expiresAt' => $result['expiresAt'],
    'version' => basename($resolvedKey),
]);
