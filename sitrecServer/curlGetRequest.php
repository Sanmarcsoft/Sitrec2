<?php
// Simple cURL proxy function to forward requests with Authorization header (if present)
function curlGetRequest($url) {
    $ch = curl_init();

    // check for Authorization header and pass it along if present
    $headers = getallheaders();
    if (array_key_exists('Authorization', $headers)) {
        $curl_headers = [
            'Authorization: ' . $headers['Authorization'],
        ];
        curl_setopt($ch, CURLOPT_HTTPHEADER, $curl_headers);
    }
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $data = curl_exec($ch);
    $http_status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    return [
        'data' => $data,
        'http_status' => $http_status
    ];
}
?>
