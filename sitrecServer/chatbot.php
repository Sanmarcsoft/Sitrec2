<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/config_paths.php';
require_once __DIR__ . '/user.php';

// Load API keys from environment
$OPENAI_API_KEY = getenv("OPENAI_API");
$ANTHROPIC_API_KEY = getenv("ANTHROPIC_API");
$GROQ_API_KEY = getenv("GROQ_API");
$GROK_API_KEY = getenv("GROK_API");

// Model permissions by user group
// Groups: admin=3, registered=2, verified=9, sitrec=14
$MODEL_PERMISSIONS = [
    3 => [ // admin - all models
        ['provider' => 'openai', 'model' => 'gpt-4o', 'label' => 'GPT-4o'],
        ['provider' => 'openai', 'model' => 'gpt-4o-mini', 'label' => 'GPT-4o Mini'],
        ['provider' => 'anthropic', 'model' => 'claude-sonnet-4-20250514', 'label' => 'Claude Sonnet 4'],
        ['provider' => 'anthropic', 'model' => 'claude-sonnet-4-5-20250929', 'label' => 'Claude Sonnet 4.5'],
        ['provider' => 'anthropic', 'model' => 'claude-haiku-4-5-20251001', 'label' => 'Claude Haiku 4.5'],
        ['provider' => 'groq', 'model' => 'llama-3.3-70b-versatile', 'label' => 'Llama 3.3 70B (Groq)'],
        ['provider' => 'groq', 'model' => 'llama-3.1-8b-instant', 'label' => 'Llama 3.1 8B (Groq)'],
        ['provider' => 'grok', 'model' => 'grok-2-latest', 'label' => 'Grok 2'],
    ],
    14 => [ // sitrec - premium models
        ['provider' => 'openai', 'model' => 'gpt-4o', 'label' => 'GPT-4o'],
        ['provider' => 'anthropic', 'model' => 'claude-sonnet-4-20250514', 'label' => 'Claude Sonnet 4'],
        ['provider' => 'groq', 'model' => 'llama-3.3-70b-versatile', 'label' => 'Llama 3.3 70B (Groq)'],
    ],
    9 => [ // verified - mid-tier models
        ['provider' => 'openai', 'model' => 'gpt-4o-mini', 'label' => 'GPT-4o Mini'],
        ['provider' => 'groq', 'model' => 'llama-3.3-70b-versatile', 'label' => 'Llama 3.3 70B (Groq)'],
    ],
    2 => [ // registered - basic models
        ['provider' => 'groq', 'model' => 'llama-3.1-8b-instant', 'label' => 'Llama 3.1 8B (Groq)'],
    ],
];

// Get available models for a user based on their groups
function getAvailableModels($userGroups) {
    global $MODEL_PERMISSIONS, $OPENAI_API_KEY, $ANTHROPIC_API_KEY, $GROQ_API_KEY, $GROK_API_KEY;
    
    $models = [];
    $seen = [];
    
    // Collect models from all user groups (higher privilege groups first)
    $groupOrder = [3, 14, 9, 2]; // admin, sitrec, verified, registered
    foreach ($groupOrder as $group) {
        if (in_array($group, $userGroups) && isset($MODEL_PERMISSIONS[$group])) {
            foreach ($MODEL_PERMISSIONS[$group] as $model) {
                $key = $model['provider'] . ':' . $model['model'];
                if (!isset($seen[$key])) {
                    // Only include if we have the API key for this provider
                    $hasKey = match($model['provider']) {
                        'openai' => !empty($OPENAI_API_KEY),
                        'anthropic' => !empty($ANTHROPIC_API_KEY),
                        'groq' => !empty($GROQ_API_KEY),
                        'grok' => !empty($GROK_API_KEY),
                        default => false
                    };
                    if ($hasKey) {
                        $models[] = $model;
                        $seen[$key] = true;
                    }
                }
            }
        }
    }
    
    return $models;
}

// Handle fetchModels request
if (isset($_GET['fetchModels'])) {
    header('Content-Type: application/json');
    $userInfo = getUserInfo();
    $models = getAvailableModels($userInfo['user_groups']);
    echo json_encode([
        'models' => $models,
        'userId' => $userInfo['user_id'],
        'userGroups' => $userInfo['user_groups']
    ]);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);
$prompt = $data['prompt'] ?? '';
$history = $data['history'] ?? [];
$sitrecDoc = $data['sitrecDoc'] ?? [];
$menuSummary = $data['menuSummary'] ?? [];
$date = $data['dateTime'] ?? date('Y-m-d H:i:s');
$requestedProvider = $data['provider'] ?? null;
$requestedModel = $data['model'] ?? null;

// Validate requested model against user's permissions
$userInfo = getUserInfo();
$availableModels = getAvailableModels($userInfo['user_groups']);
$selectedProvider = null;
$selectedModel = null;

if ($requestedProvider && $requestedModel) {
    foreach ($availableModels as $m) {
        if ($m['provider'] === $requestedProvider && $m['model'] === $requestedModel) {
            $selectedProvider = $requestedProvider;
            $selectedModel = $requestedModel;
            break;
        }
    }
}

// Fall back to first available model if requested model not allowed
if (!$selectedProvider && !empty($availableModels)) {
    $selectedProvider = $availableModels[0]['provider'];
    $selectedModel = $availableModels[0]['model'];
}

// Build tools array from sitrecDoc (OpenAI format, will convert for Anthropic)
function buildToolsFromDoc($sitrecDoc, $menuSummary) {
    $tools = [];
    $addedNames = [];
    
    // Menu function names that we'll add manually with better schemas
    $menuFunctions = ['setMenuValue', 'getMenuValue', 'executeMenuButton', 'listMenus', 'listMenuControls'];
    
    // Parse sitrecDoc entries to extract function schemas
    foreach ($sitrecDoc as $fn => $desc) {
        // Skip menu functions - we'll add them with better schemas below
        if (in_array($fn, $menuFunctions)) {
            continue;
        }
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
            preg_match_all('/(\w+)\s*\(([^)]+)\)/', $paramsStr, $paramMatches, PREG_SET_ORDER);
            
            $properties = [];
            $required = [];
            foreach ($paramMatches as $pm) {
                $paramName = $pm[1];
                $paramDesc = $pm[2];
                
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
    
    // Build short menu list for tool descriptions (just menu IDs)
    $menuIds = !empty($menuSummary) ? implode(", ", array_keys($menuSummary)) : "view, camera, satellites, terrain";
    
    // Add menu control functions (keep descriptions short - full list is in system prompt)
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "setMenuValue",
            "description" => "Set a menu control's value. Available menus: $menuIds. See system prompt for full control list.",
            "parameters" => [
                "type" => "object",
                "properties" => [
                    "menu" => ["type" => "string", "description" => "Menu ID"],
                    "path" => ["type" => "string", "description" => "Control name or path with '/' for nested folders"],
                    "value" => ["description" => "New value (number, boolean, or string)"]
                ],
                "required" => ["menu", "path", "value"]
            ]
        ]
    ];
    
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "getMenuValue",
            "description" => "Get the current value of a menu control.",
            "parameters" => [
                "type" => "object",
                "properties" => [
                    "menu" => ["type" => "string", "description" => "Menu ID"],
                    "path" => ["type" => "string", "description" => "Control name or path"]
                ],
                "required" => ["menu", "path"]
            ]
        ]
    ];
    
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "executeMenuButton",
            "description" => "Click/execute a button control in a menu.",
            "parameters" => [
                "type" => "object",
                "properties" => [
                    "menu" => ["type" => "string", "description" => "Menu ID"],
                    "path" => ["type" => "string", "description" => "Button name or path"]
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
            "parameters" => ["type" => "object", "properties" => new stdClass()]
        ]
    ];
    
    $tools[] = [
        "type" => "function",
        "function" => [
            "name" => "listMenuControls",
            "description" => "List all controls in a specific menu.",
            "parameters" => [
                "type" => "object",
                "properties" => ["menu" => ["type" => "string", "description" => "Menu ID to list controls for"]],
                "required" => ["menu"]
            ]
        ]
    ];
    
    return $tools;
}

// Convert OpenAI tools format to Anthropic format
function convertToolsForAnthropic($tools) {
    $anthropicTools = [];
    foreach ($tools as $tool) {
        $anthropicTools[] = [
            "name" => $tool["function"]["name"],
            "description" => $tool["function"]["description"],
            "input_schema" => $tool["function"]["parameters"]
        ];
    }
    return $anthropicTools;
}

$tools = buildToolsFromDoc($sitrecDoc, $menuSummary);

// Build menu documentation for system prompt (limit size to avoid token limits)
$menuDocForPrompt = "";
if (!empty($menuSummary)) {
    $menuDocForPrompt = "\n\nAVAILABLE MENU CONTROLS:\n";
    $totalControls = 0;
    $maxControls = 9999; // Limit to prevent huge prompts (temporarily high for debugging)
    
    foreach ($menuSummary as $menuId => $controls) {
        if (!empty($controls) && $totalControls < $maxControls) {
            $menuDocForPrompt .= "\nMenu '$menuId':\n";
            foreach ($controls as $control) {
                if ($totalControls >= $maxControls) {
                    $menuDocForPrompt .= "  - (more controls available - use listMenuControls)\n";
                    break;
                }
                $menuDocForPrompt .= "  - $control\n";
                $totalControls++;
            }
        }
    }
    $menuDocForPrompt .= "\nUse setMenuValue with menu ID and control path (e.g., 'Flow Orbs/Visible' for nested). Use listMenuControls to see all controls in a menu.\n";
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

When the user asks you to DO something (set, change, move, show, hide, point, go to, etc.), USE THE APPROPRIATE FUNCTION IMMEDIATELY. Do not explore or list menus first - directly call setMenuValue or executeMenuButton with your best guess for the menu and control name. The system uses flexible matching so partial names work. If it fails, you can then try other names or list controls.

IMPORTANT: Always execute the requested action, even if you think it was already done or the value is already set. The user may want to ensure the setting is applied. Never refuse to call a function just because you believe the state is already correct.

If the user confirms with "yes", "ok", "sure", "do it", etc., EXECUTE the action you proposed by calling the function.

Keep responses brief. Focus on being helpful.

Do not discuss anything unrelated to Sitrec, including people, events, or politics. But you can talk about Mick West.
EOT;

$systemPrompt .= $menuDocForPrompt;

// Call OpenAI API
function callOpenAI($apiKey, $systemPrompt, $history, $tools, $model = 'gpt-4o') {
    $messages = [["role" => "system", "content" => $systemPrompt]];
    foreach ($history as $msg) {
        $role = $msg['role'] === 'bot' ? 'assistant' : $msg['role'];
        $messages[] = ["role" => $role, "content" => $msg['text']];
    }
    
    $ch = curl_init("https://api.openai.com/v1/chat/completions");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer $apiKey",
            "Content-Type: application/json"
        ],
        CURLOPT_POSTFIELDS => json_encode([
            "model" => $model,
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
    
    if (!empty($message['tool_calls'])) {
        foreach ($message['tool_calls'] as $tc) {
            $args = json_decode($tc['function']['arguments'], true);
            $calls[] = [
                "fn" => $tc['function']['name'],
                "args" => $args ?? []
            ];
        }
    }
    
    return [
        'text' => trim($text),
        'apiCalls' => $calls,
        'debug' => [
            'provider' => 'openai',
            'model' => $model,
            'hasToolCalls' => !empty($message['tool_calls']),
            'toolCallCount' => count($message['tool_calls'] ?? [])
        ]
    ];
}


// Current antropic models:
// Claude Sonnet 4.5	claude-sonnet-4-5-20250929	Recommended - best balance
// Claude Haiku 4.5	    claude-haiku-4-5-20251001	Fastest, cheapest
// Claude Opus 4.5	    claude-opus-4-5-20251101	Most intelligent, higher cost

// Call Anthropic (Claude) API
function callAnthropic($apiKey, $systemPrompt, $history, $tools, $model = 'claude-sonnet-4-20250514') {
    $messages = [];
    foreach ($history as $msg) {
        $role = $msg['role'] === 'bot' ? 'assistant' : 'user';
        $messages[] = ["role" => $role, "content" => $msg['text']];
    }
    
    // Anthropic requires at least one message
    if (empty($messages)) {
        return [
            'text' => 'Error: No messages to send',
            'apiCalls' => [],
            'debug' => ['provider' => 'anthropic', 'model' => $model, 'error' => 'No messages']
        ];
    }
    
    $anthropicTools = convertToolsForAnthropic($tools);
    
    $requestBody = [
        "model" => $model,
        "max_tokens" => 1024,
        "system" => $systemPrompt,
        "messages" => $messages,
        "tools" => $anthropicTools
    ];
    
    $ch = curl_init("https://api.anthropic.com/v1/messages");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "x-api-key: $apiKey",
            "anthropic-version: 2023-06-01",
            "Content-Type: application/json"
        ],
        CURLOPT_POSTFIELDS => json_encode($requestBody)
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    
    // Check for curl errors
    if ($curlError) {
        return [
            'text' => "Error: $curlError",
            'apiCalls' => [],
            'debug' => ['provider' => 'anthropic', 'curlError' => $curlError]
        ];
    }
    
    $parsed = json_decode($response, true);
    
    // Check for API errors
    if (isset($parsed['error'])) {
        return [
            'text' => "Anthropic API error: " . ($parsed['error']['message'] ?? 'Unknown error'),
            'apiCalls' => [],
            'debug' => [
                'provider' => 'anthropic',
                'httpCode' => $httpCode,
                'error' => $parsed['error']
            ]
        ];
    }
    
    $content = $parsed['content'] ?? [];
    
    $text = '';
    $calls = [];
    
    foreach ($content as $block) {
        if ($block['type'] === 'text') {
            $text .= $block['text'];
        } elseif ($block['type'] === 'tool_use') {
            $calls[] = [
                "fn" => $block['name'],
                "args" => $block['input'] ?? []
            ];
        }
    }
    
    return [
        'text' => trim($text),
        'apiCalls' => $calls,
        'debug' => [
            'provider' => 'anthropic',
            'model' => $model,
            'hasToolCalls' => !empty($calls),
            'toolCallCount' => count($calls),
            'stopReason' => $parsed['stop_reason'] ?? null,
            'httpCode' => $httpCode
        ]
    ];
}

// Groq models (OpenAI-compatible API, very fast inference):
// llama-3.3-70b-versatile - Best quality
// llama-3.1-8b-instant - Fastest
// mixtral-8x7b-32768 - Good balance

// Call Groq API (OpenAI-compatible)
function callGroq($apiKey, $systemPrompt, $history, $tools, $model = 'llama-3.3-70b-versatile') {
    $messages = [["role" => "system", "content" => $systemPrompt]];
    foreach ($history as $msg) {
        $role = $msg['role'] === 'bot' ? 'assistant' : $msg['role'];
        $messages[] = ["role" => $role, "content" => $msg['text']];
    }
    
    $ch = curl_init("https://api.groq.com/openai/v1/chat/completions");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer $apiKey",
            "Content-Type: application/json"
        ],
        CURLOPT_POSTFIELDS => json_encode([
            "model" => $model,
            "messages" => $messages,
            "tools" => $tools,
            "tool_choice" => "auto",
            "temperature" => 0.2
        ])
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    
    if ($curlError) {
        return [
            'text' => "Error: $curlError",
            'apiCalls' => [],
            'debug' => ['provider' => 'groq', 'curlError' => $curlError]
        ];
    }
    
    $parsed = json_decode($response, true);
    
    if (isset($parsed['error'])) {
        return [
            'text' => "Groq API error: " . ($parsed['error']['message'] ?? 'Unknown error'),
            'apiCalls' => [],
            'debug' => ['provider' => 'groq', 'httpCode' => $httpCode, 'error' => $parsed['error']]
        ];
    }
    
    $message = $parsed['choices'][0]['message'] ?? [];
    $text = $message['content'] ?? '';
    $calls = [];
    
    if (!empty($message['tool_calls'])) {
        foreach ($message['tool_calls'] as $tc) {
            $args = json_decode($tc['function']['arguments'], true);
            $calls[] = [
                "fn" => $tc['function']['name'],
                "args" => $args ?? []
            ];
        }
    }
    
    return [
        'text' => trim($text),
        'apiCalls' => $calls,
        'debug' => [
            'provider' => 'groq',
            'model' => $model,
            'hasToolCalls' => !empty($message['tool_calls']),
            'toolCallCount' => count($message['tool_calls'] ?? []),
            'httpCode' => $httpCode
        ]
    ];
}

// xAI Grok models (OpenAI-compatible API):
// grok-2-latest - Latest Grok 2
// grok-beta - Beta version

// Call xAI Grok API (OpenAI-compatible)
function callGrok($apiKey, $systemPrompt, $history, $tools, $model = 'grok-2-latest') {
    $messages = [["role" => "system", "content" => $systemPrompt]];
    foreach ($history as $msg) {
        $role = $msg['role'] === 'bot' ? 'assistant' : $msg['role'];
        $messages[] = ["role" => $role, "content" => $msg['text']];
    }
    
    $ch = curl_init("https://api.x.ai/v1/chat/completions");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer $apiKey",
            "Content-Type: application/json"
        ],
        CURLOPT_POSTFIELDS => json_encode([
            "model" => $model,
            "messages" => $messages,
            "tools" => $tools,
            "tool_choice" => "auto",
            "temperature" => 0.2
        ])
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    
    if ($curlError) {
        return [
            'text' => "Error: $curlError",
            'apiCalls' => [],
            'debug' => ['provider' => 'grok', 'curlError' => $curlError]
        ];
    }
    
    $parsed = json_decode($response, true);
    
    if (isset($parsed['error'])) {
        return [
            'text' => "Grok API error: " . ($parsed['error']['message'] ?? 'Unknown error'),
            'apiCalls' => [],
            'debug' => ['provider' => 'grok', 'httpCode' => $httpCode, 'error' => $parsed['error']]
        ];
    }
    
    $message = $parsed['choices'][0]['message'] ?? [];
    $text = $message['content'] ?? '';
    $calls = [];
    
    if (!empty($message['tool_calls'])) {
        foreach ($message['tool_calls'] as $tc) {
            $args = json_decode($tc['function']['arguments'], true);
            $calls[] = [
                "fn" => $tc['function']['name'],
                "args" => $args ?? []
            ];
        }
    }
    
    return [
        'text' => trim($text),
        'apiCalls' => $calls,
        'debug' => [
            'provider' => 'grok',
            'model' => $model,
            'hasToolCalls' => !empty($message['tool_calls']),
            'toolCallCount' => count($message['tool_calls'] ?? []),
            'httpCode' => $httpCode
        ]
    ];
}

// Call the appropriate provider based on user selection
if (!$selectedProvider) {
    $result = [
        'text' => 'Error: No models available for your account',
        'apiCalls' => [],
        'debug' => ['error' => 'No available models']
    ];
} elseif ($selectedProvider === 'anthropic') {
    $result = callAnthropic($ANTHROPIC_API_KEY, $systemPrompt, $history, $tools, $selectedModel);
} elseif ($selectedProvider === 'groq') {
    $result = callGroq($GROQ_API_KEY, $systemPrompt, $history, $tools, $selectedModel);
} elseif ($selectedProvider === 'grok') {
    $result = callGrok($GROK_API_KEY, $systemPrompt, $history, $tools, $selectedModel);
} else {
    $result = callOpenAI($OPENAI_API_KEY, $systemPrompt, $history, $tools, $selectedModel);
}

header('Content-Type: application/json');
echo json_encode($result);
