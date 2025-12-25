<?php
// This is specific to the Starlink historical data from Space-Track.org
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/curlGetRequest.php';

// SECURITY: Rate limiting by IP - max 20 requests per minute (Space-Track has strict limits)
$clientIP = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateLimitDir = sys_get_temp_dir() . '/sitrec_starlink_ratelimit/';
if (!is_dir($rateLimitDir)) {
    @mkdir($rateLimitDir, 0755, true);
}
$rateLimitFile = $rateLimitDir . md5($clientIP) . ".json";
$now = time();
$rateData = file_exists($rateLimitFile) ? json_decode(file_get_contents($rateLimitFile), true) : null;
if (!$rateData || $now > ($rateData['reset'] ?? 0)) {
    $rateData = ['count' => 0, 'reset' => $now + 60];
}
if ($rateData['count'] >= 20) {
    http_response_code(429);
    exit("Rate limit exceeded. Please wait.");
}
$rateData['count']++;
file_put_contents($rateLimitFile, json_encode($rateData), LOCK_EX);

// space-data in config.php should look like this:
//
// $spaceDataUsername = 'somthing@example.com';
// $spaceDataPassword = 'somepassword';

// need to ensure we are logged in first
//require_once __DIR__ . '/user.php';
//$userID = getUserID();
//if ($userID == "") {
//    exit("Not logged in");
//}

$zipIt = getenv('TLE_ZIP_ENABLED');

$starlink_cache = $CACHE_PATH . "starlink/";

// make sure the "starlink" folder exists in the cache directory
if (!file_exists($starlink_cache)) {
    mkdir($starlink_cache);
}

// called like: local.metabunk.org/sitrec/sitrecServer/proxyStarlink.php?request=2024-07-18
$request = isset($_GET["request"]) ? $_GET["request"] : null;

// the request code might have a ?v=8234823958235 parameter at the end (with a random string)
// so strip that off (just strip off everything after the ?)
$request = strtok($request, "?");

if (!$request) {
    exit("No request");
}

// validate the request and make sure it's in the right format
// (and for security)
if (!preg_match("/^\d{4}-\d{2}-\d{2}$/", $request)) {
    exit("Invalid request key ".$request);
}

// Whitelist the allowed types explicitly
$allowed_types = ["", "LEO", "ALL", "SLOW", "LEOALL", "CUSTOM"];

$type = isset($_GET["type"]) ? $_GET["type"] : "";
if (!in_array($type, $allowed_types, true)) {
    exit("Invalid type parameter");
}

// given request in the form of YYYY-MM-DD
// calculate nextDay in the same form, and use 2 days later
$nextDay = date('Y-m-d', strtotime($request . ' +2 days'));

// the default STARLINK query
$url = "https://www.space-track.org/basicspacedata/query/class/gp_history/CREATION_DATE/" . $request . "--" . $nextDay . "/orderby/NORAD_CAT_ID,EPOCH/format/3le/OBJECT_NAME/STARLINK~~";

// LEO is Low Earth object, but here filter for payloads only
// decay_date/null-val filters out decayed objects per Space-Track recommendations
if ($type == "LEO") {
    $url = "https://www.space-track.org/basicspacedata/query/class/gp_history/EPOCH/" . $request . "--" . $nextDay . "/MEAN_MOTION/>11.25/ECCENTRICITY/<0.25/OBJECT_TYPE/payload/decay_date/null-val/orderby/NORAD_CAT_ID,EPOCH/format/3le";
}

// LEOALL is all the LEO objects, including payloads and debris
if ($type == "LEOALL") {
    $url = "https://www.space-track.org/basicspacedata/query/class/gp_history/EPOCH/" . $request . "--" . $nextDay . "/MEAN_MOTION/>11.25/ECCENTRICITY/<0.25/decay_date/null-val/format/3le";
}

if ($type == "SLOW") {
    // SLOW is for objects with a mean motion of less than 11.25 (using 11.26 to overlap with LEO a little)
    $url = "https://www.space-track.org/basicspacedata/query/class/gp_history/EPOCH/" . $request . "--" . $nextDay . "/MEAN_MOTION/<11.26/decay_date/null-val/format/3le";
}

// override for ALL query
if ($type == "ALL") {
    $url = "https://www.space-track.org/basicspacedata/query/class/gp_history/CREATION_DATE/" . $request . "--" . $nextDay . "/decay_date/null-val/orderby/NORAD_CAT_ID,EPOCH/format/3le";
}

// CUSTOM TLE handling
if ($type == "CUSTOM") {
    $customTleUrl = getenv('CUSTOM_TLE');
    if (!$customTleUrl) {
        exit("CUSTOM_TLE not configured");
    }
    
    $dateParts = explode('-', $request);
    if (count($dateParts) != 3) {
        exit("Invalid date format for CUSTOM TLE");
    }
    
    $year = (int)$dateParts[0];
    $month = (int)$dateParts[1];
    $day = (int)$dateParts[2];
    
    if ($year < 1900 || $year > 2100) {
        exit("Invalid year for CUSTOM TLE (must be 1900-2100)");
    }

    // get a 2-digit year (unlikely to be used, but just in case)
    $year2 = $year % 100;
    
    if ($month < 1 || $month > 12) {
        exit("Invalid month for CUSTOM TLE (must be 1-12)");
    }
    
    if ($day < 1 || $day > 31) {
        exit("Invalid day for CUSTOM TLE (must be 1-31)");
    }

    $url = str_replace(['{DD}', '{MM}', '{YYYY}', '{YY}'], [sprintf("%02d", $day), sprintf("%02d", $month), sprintf("%04d", $year), sprintf("%02d", $year2)], $customTleUrl);
}

// if the getTLECustom function is defined, use that to get the URL
if (function_exists('getTLECustom')) {
    $url = getTLECustom($request, $nextDay, $type, $url);
}


// encode angle brackets for compatibility with cURL
$url = encodeAngleBrackets($url);

// Determine if we should cache
$caching = true;
if ($type == "CUSTOM" && !getenv('CACHE_CUSTOM_TLE')) {
    $caching = false;
}

// File naming setup
$baseFileName = $request . $type;
$cachedTLE = $starlink_cache . $baseFileName . ".tle";
$cachedZIP = $starlink_cache . $baseFileName . ".tle.zip";

if ($caching) {
    if ($zipIt) {
        if (file_exists($cachedZIP)) {
            header("Location: " . $cachedZIP);
            exit();
        }

        if (file_exists($cachedTLE)) {
            if (zipTLE($cachedTLE, $cachedZIP, $baseFileName . ".tle")) {
                unlink($cachedTLE);
                header("Location: " . $cachedZIP);
                exit();
            } else {
                exit("Failed to create ZIP from existing TLE");
            }
        }
    } else {
        if (file_exists($cachedTLE)) {
            header("Location: " . $cachedTLE);
            exit();
        }
    }
}

// For CUSTOM type, use simple GET request without Space-Track login
if ($type == "CUSTOM") {
    $result = curlGetRequest($url);
    $data = $result['data'];
    $http_status = $result['http_status'];
} else {
    // retrieve Space-Track login credentials from environment
    $username = getenv('SPACEDATA_USERNAME');
    $password = getenv('SPACEDATA_PASSWORD');

    // Space-Track.org login URL
    $loginUrl = 'https://www.space-track.org/ajaxauth/login';

    // Space-Track.org data query URL (calculated earlier)
    $dataUrl = $url;

    // Check if credentials are configured
    if (empty($username) || empty($password)) {
        die('ERROR: Space-Track credentials not configured. Set SPACEDATA_USERNAME and SPACEDATA_PASSWORD environment variables.');
    }

    // Initialize cURL session
    $ch = curl_init();

    // SECURITY: Store cookies in temp directory, not web-accessible directory
    $cookieFile = sys_get_temp_dir() . '/sitrec_spacetrack_cookies.txt';
    
    // Set cURL options for login
    curl_setopt($ch, CURLOPT_URL, $loginUrl);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query(['identity' => $username, 'password' => $password]));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile); // Save cookies for subsequent requests
    curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile); // Use saved cookies

    // Execute login request
    $response = curl_exec($ch);
    $curl_error = curl_error($ch);
    $http_status = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    // Check for cURL errors during login
    if ($response === false) {
        curl_close($ch);
        die('ERROR: Space-Track login cURL failed: ' . $curl_error);
    }

    // Check for login errors
    if ($http_status !== 200) {
        curl_close($ch);
        die('ERROR: Space-Track login failed with HTTP ' . $http_status . '. Username: ' . $username . '. Check credentials.');
    }

    // Set cURL options for data query
    curl_setopt($ch, CURLOPT_URL, $dataUrl);
    curl_setopt($ch, CURLOPT_POST, false);
    curl_setopt($ch, CURLOPT_HTTPGET, true);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, false); // Set to false to exclude headers from the response

    // Execute data query request
    $data = curl_exec($ch);
    $curl_error = curl_error($ch);
    $http_status = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    // Close cURL session
    curl_close($ch);

    // Check for cURL errors during data query
    if ($data === false) {
        die('ERROR: Space-Track data query cURL failed: ' . $curl_error . '. URL: ' . $dataUrl);
    }
}


// Check for data query errors, and zero length data
if ($data === false || empty($data)) {
    die('ERROR: Space-Track query returned no data. Request: ' . $request . ', Type: ' . ($type ?: 'STARLINK') . ', URL: ' . $url);
}

// Check for HTTP errors (including 5xx server errors)
if ($http_status !== 200) {
    die('ERROR: Space-Track query failed with HTTP ' . $http_status . '. Request: ' . $request . ', Type: ' . ($type ?: 'STARLINK') . ', Response: ' . substr($data, 0, 500));
}

// Check if response looks like an HTML error page instead of TLE data
$trimmedData = trim($data);
if (stripos($trimmedData, '<!DOCTYPE') === 0 || stripos($trimmedData, '<html') === 0) {
    die('ERROR: Space-Track returned HTML instead of TLE data (server error). Request: ' . $request . ', Type: ' . ($type ?: 'STARLINK') . ', Response: ' . substr($data, 0, 500));
}


// check that the first line contains "STARLINK" if the default type
$lines = explode("\n", $data);
if ($type == "" && strpos($lines[0], "STARLINK") === false) {
    die('ERROR: Expected STARLINK data but got: ' . substr($lines[0], 0, 100) . '. Request: ' . $request);
}

if ($caching) {
    if (file_put_contents($cachedTLE, $data) === false) {
        exit("Failed to write TLE cache file");
    }

    if ($zipIt) {
        if (!zipTLE($cachedTLE, $cachedZIP, $baseFileName . ".tle")) {
            exit("Failed to create zip file");
        }

        unlink($cachedTLE);

        header("Location: " . $cachedZIP);
    } else {
        header("Location: " . $cachedTLE);
    }
} else {
    if ($zipIt) {
        $tempTLE = tempnam(sys_get_temp_dir(), 'tle_');
        $tempZIP = $tempTLE . '.zip';
        
        file_put_contents($tempTLE, $data);
        
        if (zipTLE($tempTLE, $tempZIP, $baseFileName . ".tle")) {
            unlink($tempTLE);
            header('Content-Type: application/zip');
            header('Content-Disposition: attachment; filename="' . $baseFileName . '.tle.zip"');
            readfile($tempZIP);
            unlink($tempZIP);
        } else {
            unlink($tempTLE);
            exit('Failed to create zip file');
        }
    } else {
        header('Content-Type: text/plain');
        echo $data;
    }
}

exit();


// Helper to encode < and > in a Space-Track URL
function encodeAngleBrackets($url) {
    return str_replace(['<', '>'], ['%3C', '%3E'], $url);
}

// Helper to zip a .tle file
function zipTLE($tleFile, $zipFile, $tleNameInZip) {
    $zip = new ZipArchive();
    if ($zip->open($zipFile, ZipArchive::CREATE) === TRUE) {
        $zip->addFile($tleFile, $tleNameInZip);
        $zip->close();
        return true;
    }
    return false;
}
?>
