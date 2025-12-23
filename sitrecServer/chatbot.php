<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';

// Load API key from environment or config
$OPENAI_API_KEY = getenv("OPENAI_API");

$data = json_decode(file_get_contents('php://input'), true);
$prompt = $data['prompt'] ?? '';
$history = $data['history'] ?? [];
$sitrecDoc = $data['sitrecDoc'] ?? [];
$menuSummary = $data['menuSummary'] ?? [];
$date = $data['dateTime'] ?? date('Y-m-d H:i:s');

// Build tools array from sitrecDoc
function buildToolsFromDoc($sitrecDoc, $menuSummary) {
    $tools = [];
    
    // Parse sitrecDoc entries to extract function schemas
    // Format: "Description. Parameters: param1 (type desc), param2 (type desc)"
    foreach ($sitrecDoc as $fn => $desc) {
        $tool = [
            "type" => "function",
            "function" => [
                "name" => $fn,
                "description" => $desc,
                "parameters" => [
                    "type" => "object",
                    "properties" => new stdClass(),
                    "required" => []
                ]
            ]
        ];
        
        // Try to extract parameters from description
        if (preg_match('/Parameters:\s*(.+)$/i', $desc, $matches)) {
            $paramsStr = $matches[1];
            // Match patterns like: paramName (type description)
            preg_match_all('/(\w+)\s*\(([^)]+)\)/', $paramsStr, $paramMatches, PREG_SET_ORDER);
            
            $properties = [];
            $required = [];
            foreach ($paramMatches as $pm) {
                $paramName = $pm[1];
                $paramDesc = $pm[2];
                
                // Determine type from description
                $type = "string";
                if (stripos($paramDesc, 'float') !== false || stripos($paramDesc, 'number') !== false) {
                    $type = "number";
                } elseif (stripos($paramDesc, 'int') !== false) {
                    $type = "integer";
                } elseif (stripos($paramDesc, 'bool') !== false) {
                    $type = "boolean";
                }
                
                $properties[$paramName] = [
                    "type" => $type,
                    "description" => $paramDesc
                ];
                
                // If not marked as optional, it's required
                if (stripos($paramDesc, 'optional') === false) {
                    $required[] = $paramName;
                }
            }
            
            if (!empty($properties)) {
                $tool["function"]["parameters"]["properties"] = $properties;
                $tool["function"]["parameters"]["required"] = $required;
            }
        }
        
        $tools[] = $tool;
    }
    
    // Build menu controls description for context (no truncation)
    $menuDesc = "";
    if (!empty($menuSummary)) {
        $menuDesc = "Available menus and controls:\n";
        foreach ($menuSummary as $menuId => $controls) {
            if (!empty($controls)) {
                $menuDesc .= "Menu '$menuId': " . implode(", ", $controls) . "\n";
            }
        }
    }
    
    // Add menu control functions
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "setMenuValue",
            "description" => "Set a menu control's value. " . $menuDesc,
            "parameters" => [
                "type" => "object",
                "properties" => [
                    "menu" => [
                        "type" => "string",
                        "description" => "Menu ID (e.g. 'view', 'camera', 'satellites', 'terrain', 'showhide', 'objects')"
                    ],
                    "path" => [
                        "type" => "string",
                        "description" => "Control name or path with '/' for nested folders (e.g. 'Zoom (fov)', 'Views/Video')"
                    ],
                    "value" => [
                        "description" => "New value (type depends on control: number, boolean, string)"
                    ]
                ],
                "required" => ["menu", "path", "value"]
            ]
        ]
    ];
    
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "getMenuValue",
            "description" => "Get the current value of a menu control. " . $menuDesc,
            "parameters" => [
                "type" => "object",
                "properties" => [
                    "menu" => [
                        "type" => "string",
                        "description" => "Menu ID (e.g. 'view', 'camera', 'satellites')"
                    ],
                    "path" => [
                        "type" => "string",
                        "description" => "Control name or path with '/' for nested folders"
                    ]
                ],
                "required" => ["menu", "path"]
            ]
        ]
    ];
    
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "executeMenuButton",
            "description" => "Click/execute a button control in a menu. " . $menuDesc,
            "parameters" => [
                "type" => "object",
                "properties" => [
                    "menu" => [
                        "type" => "string",
                        "description" => "Menu ID (e.g. 'objects', 'view')"
                    ],
                    "path" => [
                        "type" => "string",
                        "description" => "Button name or path with '/' for nested folders"
                    ]
                ],
                "required" => ["menu", "path"]
            ]
        ]
    ];
    
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "listMenus",
            "description" => "List all available menu IDs.",
            "parameters" => [
                "type" => "object",
                "properties" => new stdClass()
            ]
        ]
    ];
    
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "listMenuControls",
            "description" => "List all controls in a specific menu.",
            "parameters" => [
                "type" => "object",
                "properties" => [
                    "menu" => [
                        "type" => "string",
                        "description" => "Menu ID to list controls for"
                    ]
                ],
                "required" => ["menu"]
            ]
        ]
    ];
    
    return $tools;
}

$tools = buildToolsFromDoc($sitrecDoc, $menuSummary);

// Build full menu documentation for system prompt
$menuDocForPrompt = "";
if (!empty($menuSummary)) {
    $menuDocForPrompt = "\n\nAVAILABLE MENU CONTROLS:\n";
    foreach ($menuSummary as $menuId => $controls) {
        if (!empty($controls)) {
            $menuDocForPrompt .= "\nMenu '$menuId':\n";
            foreach ($controls as $control) {
                $menuDocForPrompt .= "  - $control\n";
            }
        }
    }
    $menuDocForPrompt .= "\nUse setMenuValue with menu ID and control path (e.g., 'Flow Orbs/Visible' for nested controls).\n";
}

$systemPrompt = <<<EOT
You are a helpful assistant for the Sitrec app. 

You should reply in the same language as the user's prompt, unless instructed otherwise.

The user's current real date and time (not the simulation time) is: {$date}. Use the timezone specified here, or any specified in the prompt.

When giving a time, always use the user's local time, unless they specify UTC or another timezone.

You can answer questions about Sitrec and call functions to control the application.

Sitrec is a Situation Recreation application written by Mick West. It can:
- Show satellite positions in the sky
- Show ADS-B aircraft positions
- Show astronomy objects in the sky
- Set the camera to follow or track objects
The primary use is for resolving UAP sightings and other events by showing what was in the sky at a given time.

When the user asks you to DO something (set, change, move, show, hide, point, go to, etc.), USE THE APPROPRIATE FUNCTION. Do not just describe what you would do - actually call the function.

IMPORTANT: Always execute the requested action, even if you think it was already done or the value is already set. The user may want to ensure the setting is applied. Never refuse to call a function just because you believe the state is already correct.

If the user confirms with "yes", "ok", "sure", "do it", etc., EXECUTE the action you proposed by calling the function.

Keep responses brief. Focus on being helpful.

Do not discuss anything unrelated to Sitrec, including people, events, or politics. But you can talk about Mick West.
EOT;

$systemPrompt .= $menuDocForPrompt;

// Build messages array from history
$messages = [["role" => "system", "content" => $systemPrompt]];
if (is_array($history)) {
    foreach ($history as $msg) {
        $role = $msg['role'] === 'bot' ? 'assistant' : $msg['role'];
        $messages[] = [
            "role" => $role,
            "content" => $msg['text']
        ];
    }
}

// Call OpenAI with function calling
$ch = curl_init("https://api.openai.com/v1/chat/completions");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer $OPENAI_API_KEY",
        "Content-Type: application/json"
    ],
    CURLOPT_POSTFIELDS => json_encode([
        "model" => "gpt-4-turbo",
        "messages" => $messages,
        "tools" => $tools,
        "tool_choice" => "auto",
        "temperature" => 0.2
    ])
]);

$response = curl_exec($ch);
curl_close($ch);

$parsed = json_decode($response, true);
$message = $parsed['choices'][0]['message'] ?? [];
$text = $message['content'] ?? '';
$calls = [];

// Extract tool calls from response
if (!empty($message['tool_calls'])) {
    foreach ($message['tool_calls'] as $tc) {
        $args = json_decode($tc['function']['arguments'], true);
        $calls[] = [
            "fn" => $tc['function']['name'],
            "args" => $args ?? []
        ];
    }
}

header('Content-Type: application/json');
echo json_encode([
    'text' => trim($text),
    'apiCalls' => $calls,
    'debug' => [
        'hasToolCalls' => !empty($message['tool_calls']),
        'toolCallCount' => count($message['tool_calls'] ?? []),
        'messageKeys' => array_keys($message)
    ]
]);
