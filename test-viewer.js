#!/usr/bin/env node

import {exec, spawn} from 'child_process';
import express from 'express';
import {WebSocketServer} from 'ws';
import {fileURLToPath} from 'url';
import {dirname} from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3456;
const exitAfterTests = process.argv.includes('--exit') || process.env.TEST_VIEWER_EXIT === 'true';
const noRedirect = process.argv.includes('--no-redirect');

app.use('/test-results', express.static(__dirname + '/test-results'));
app.use('/tests_regression', express.static(__dirname + '/tests_regression'));

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Sitrec Test Viewer</title>
    <style>
        body {
            margin: 0;
            padding: 10px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            background: #1e1e1e;
            color: #d4d4d4;
        }
        #container {
            width: 100%;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        h1 {
            color: #4ec9b0;
            margin: 0 0 10px 0;
            font-size: 20px;
        }
        .status {
            margin-bottom: 10px;
            padding: 10px;
            background: #2d2d30;
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .status.running { border-left: 4px solid #4ec9b0; }
        .status.complete { border-left: 4px solid #6a9955; }
        .status.error { border-left: 4px solid #f48771; }
        #workers {
            display: flex;
            gap: 8px;
            flex: 1;
            overflow: hidden;
        }
        .worker-column {
            flex: 1;
            display: flex;
            flex-direction: column;
            background: #252526;
            border: 1px solid #3e3e42;
            border-radius: 4px;
            overflow: hidden;
        }
        .worker-header {
            background: #2d2d30;
            padding: 8px;
            font-weight: bold;
            font-size: 12px;
            border-bottom: 1px solid #3e3e42;
            color: #4ec9b0;
        }
        .worker-output {
            flex: 1;
            padding: 10px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-size: 11px;
            line-height: 1.4;
        }
        .passed { color: #6a9955; }
        .failed { color: #f48771; }
        .test-line { color: #4ec9b0; }
        button {
            background: #0e639c;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover { background: #1177bb; }
        button:disabled {
            background: #3e3e42;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div id="container">
        <h1>🧪 Sitrec Test Viewer (4 Workers)</h1>
        <div id="status" class="status running">
            <span id="statusText">Connecting...</span>
            <div>
                <button id="abortBtn" onclick="abortTests()" style="background: #f48771; margin-right: 8px;">Abort</button>
                <button id="clearBtn" onclick="clearOutput()">Clear</button>
            </div>
        </div>
        <div id="workers">
            <div class="worker-column">
                <div class="worker-header">Waiting...</div>
                <div class="worker-output" id="worker-1"></div>
            </div>
            <div class="worker-column">
                <div class="worker-header">Waiting...</div>
                <div class="worker-output" id="worker-2"></div>
            </div>
            <div class="worker-column">
                <div class="worker-header">Waiting...</div>
                <div class="worker-output" id="worker-3"></div>
            </div>
            <div class="worker-column">
                <div class="worker-header">Waiting...</div>
                <div class="worker-output" id="worker-4"></div>
            </div>
        </div>
    </div>
    <script>
        const status = document.getElementById('status');
        const statusText = document.getElementById('statusText');
        const abortBtn = document.getElementById('abortBtn');
        const workers = [
            document.getElementById('worker-1'),
            document.getElementById('worker-2'),
            document.getElementById('worker-3'),
            document.getElementById('worker-4')
        ];
        
        const workerHeaders = [
            document.querySelector('.worker-column:nth-child(1) .worker-header'),
            document.querySelector('.worker-column:nth-child(2) .worker-header'),
            document.querySelector('.worker-column:nth-child(3) .worker-header'),
            document.querySelector('.worker-column:nth-child(4) .worker-header')
        ];
        
        const workerAutoScroll = [true, true, true, true];
        
        workers.forEach((worker, idx) => {
            worker.addEventListener('scroll', () => {
                const atBottom = worker.scrollHeight - worker.scrollTop <= worker.clientHeight + 50;
                workerAutoScroll[idx] = atBottom;
            });
        });

        const ws = new WebSocket('ws://localhost:${port}');
        
        ws.onopen = () => {
            statusText.textContent = 'Running tests...';
            status.className = 'status running';
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'workerName') {
                const workerIdx = data.worker;
                const testName = data.name;
                workerHeaders[workerIdx].textContent = testName;
            } else if (data.type === 'output') {
                let line = data.text;
                const workerIdx = data.worker || 0;
                
                // Add syntax highlighting
                if (line.includes('✓')) {
                    line = '<span class="passed">' + line + '</span>';
                } else if (line.includes('✗') || line.includes('failed')) {
                    line = '<span class="failed">' + line + '</span>';
                } else if (line.includes('›')) {
                    line = '<span class="test-line">' + line + '</span>';
                }
                
                workers[workerIdx].innerHTML += line + '\\n';
                
                if (workerAutoScroll[workerIdx]) {
                    workers[workerIdx].scrollTop = workers[workerIdx].scrollHeight;
                }
            } else if (data.type === 'status') {
                if (data.total > 0) {
                    const progress = data.current + '/' + data.total;
                    statusText.textContent = '🧪 Running ' + progress + ' tests on 4 workers...';
                }
            } else if (data.type === 'complete') {
                const hasFailures = data.code !== 0;
                status.className = hasFailures ? 'status error' : 'status complete';
                statusText.textContent = hasFailures 
                    ? '❌ Tests completed with failures' 
                    : '✅ All tests passed!';
                abortBtn.disabled = true;
            } else if (data.type === 'aborted') {
                status.className = 'status error';
                statusText.textContent = '🛑 Tests aborted by user';
                abortBtn.disabled = true;
            } else if (data.type === 'redirect') {
                statusText.textContent = '✅ Tests passed! Redirecting to deployed site...';
                setTimeout(() => {
                    window.location.href = data.url;
                }, 2000);
            } else if (data.type === 'error') {
                status.className = 'status error';
                statusText.textContent = '❌ Error running tests';
                workers[0].innerHTML += '<span class="failed">ERROR: ' + data.message + '</span>\\n';
            } else if (data.type === 'imageDiff') {
                window.open(data.expected, '_blank');
                window.open(data.actual, '_blank');
                window.open(data.diff, '_blank');
            }
        };
        
        ws.onerror = () => {
            status.className = 'status error';
            statusText.textContent = '❌ Connection error';
        };
        
        ws.onclose = () => {
            if (status.className === 'status running') {
                status.className = 'status error';
                statusText.textContent = '❌ Connection closed';
            }
        };

        function clearOutput() {
            workers.forEach(worker => worker.innerHTML = '');
        }

        function abortTests() {
            if (confirm('Are you sure you want to abort the tests?')) {
                ws.send(JSON.stringify({ type: 'abort' }));
                statusText.textContent = '⏳ Aborting tests...';
                abortBtn.disabled = true;
            }
        }
    </script>
</body>
</html>
    `);
});

const server = app.listen(port, () => {
    console.log(`\n🧪 Test Viewer running at http://localhost:${port}\n`);
    console.log(`Opening browser...\n`);
    
    // Auto-open browser
    const open = (url) => {
        const cmd = process.platform === 'darwin' ? 'open' : 
                    process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} ${url}`);
    };
    
    setTimeout(() => open(`http://localhost:${port}`), 500);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${port} is already in use.`);
        console.error('Killing existing test-viewer process...\n');
        
        // Kill existing test-viewer processes
        exec(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, (killErr) => {
            if (killErr) {
                console.error('Could not kill existing process. Please run:');
                console.error(`  pkill -f "node test-viewer.js"`);
                console.error(`or:`);
                console.error(`  lsof -ti:${port} | xargs kill -9`);
                process.exit(1);
            } else {
                console.log('Existing process killed. Please run the command again.');
                process.exit(1);
            }
        });
    } else {
        console.error('Server error:', err);
        process.exit(1);
    }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected\n');
    
    let totalTests = 0;
    let currentTest = 0;
    let testProcess = null;
    let isAborting = false;
    const testToWorkerMap = new Map();
    const workerTestNames = new Map();
    let nextWorker = 0;
    let lastSeenWorker = 0;
    
    // Handle incoming messages from client
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'abort' && testProcess && !isAborting) {
                console.log('\n🛑 Abort requested by user\n');
                isAborting = true;
                testProcess.kill('SIGTERM');
                ws.send(JSON.stringify({ type: 'aborted' }));
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });
    
    // Clean quarantine attributes from snapshots before running tests
    exec('find tests_regression -name "*.png" -exec xattr -d com.apple.quarantine {} \\; 2>/dev/null', { cwd: __dirname }, (err) => {
        // Ignore errors - quarantine may not exist on all files
    });
    
    // Run tests
    testProcess = spawn('npx', ['playwright', 'test'], {
        cwd: __dirname,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' }
    });

    testProcess.stdout.on('data', (data) => {
        const text = data.toString();
        process.stdout.write(text);
        
        // Parse test count: "Running 14 tests using 4 workers"
        const countMatch = text.match(/Running (\d+) tests? using/);
        if (countMatch) {
            totalTests = parseInt(countMatch[1]);
            ws.send(JSON.stringify({ 
                type: 'status', 
                current: 0, 
                total: totalTests
            }));
            // Send this to all workers
            for (let i = 0; i < 4; i++) {
                ws.send(JSON.stringify({ type: 'output', text, worker: i }));
            }
            return;
        }
        
        // Parse test progress: "  ✓  1 [chromium] › ... › test name (time)"
        // Try to match "for X" pattern first
        let testMatch = text.match(/[✓✗]\s+(\d+)\s+\[chromium\].*?for\s+(.+?)(?:\s+\(|$)/);
        if (!testMatch) {
            // Fallback: match last part after last ›
            testMatch = text.match(/[✓✗]\s+(\d+)\s+\[chromium\].*?›\s+([^›]+?)(?:\s+\(|$)/);
        }
        
        if (testMatch) {
            const testNum = parseInt(testMatch[1]);
            const testName = testMatch[2].trim();
            currentTest = testNum;
            
            // Assign worker to test if not already assigned
            if (!testToWorkerMap.has(testNum)) {
                testToWorkerMap.set(testNum, nextWorker);
                workerTestNames.set(nextWorker, testName);
                
                // Send worker name update
                ws.send(JSON.stringify({ 
                    type: 'workerName', 
                    worker: nextWorker,
                    name: testName
                }));
                
                nextWorker = (nextWorker + 1) % 4;
            }
            
            lastSeenWorker = testToWorkerMap.get(testNum);
            
            ws.send(JSON.stringify({ 
                type: 'status', 
                current: currentTest, 
                total: totalTests
            }));
            
            ws.send(JSON.stringify({ type: 'output', text, worker: lastSeenWorker }));
            return;
        }
        
        // For summary lines (X passed, X failed), send to all workers
        if (text.match(/\d+\s+(passed|failed)/)) {
            for (let i = 0; i < 4; i++) {
                ws.send(JSON.stringify({ type: 'output', text, worker: i }));
            }
            return;
        }
        
        // For other output, send to the last worker that had activity
        ws.send(JSON.stringify({ type: 'output', text, worker: lastSeenWorker }));
    });

    testProcess.stderr.on('data', (data) => {
        const text = data.toString();
        process.stderr.write(text);
        ws.send(JSON.stringify({ type: 'output', text }));
    });

    testProcess.on('close', (code) => {
        if (isAborting) {
            console.log(`\nTests aborted by user\n`);
            if (exitAfterTests) {
                setTimeout(() => {
                    console.log('Closing test viewer...\n');
                    process.exit(1);
                }, 2000);
            }
            return;
        }
        
        console.log(`\nTests completed with code ${code}\n`);
        ws.send(JSON.stringify({ type: 'complete', code }));
        
        if (exitAfterTests) {
            // In deploy mode: redirect to deployed site if tests passed, then exit
            if (code === 0) {
                if (!noRedirect) {
                    console.log('Tests passed! Redirecting browser to deployed site...\n');
                    setTimeout(() => {
                        ws.send(JSON.stringify({ 
                            type: 'redirect', 
                            url: 'https://www.metabunk.org/sitrec' 
                        }));
                    }, 500);
                } else {
                    console.log('Tests passed!\n');
                }
                
                setTimeout(() => {
                    console.log('Closing test viewer...\n');
                    process.exit(0);
                }, noRedirect ? 2000 : 4000);
            } else {
                console.log(`Tests failed with code ${code}. Not redirecting.\n`);
                setTimeout(() => {
                    console.log('Closing test viewer...\n');
                    process.exit(code);
                }, 2000);
            }
        } else {
            // In interactive mode: keep server open
            setTimeout(() => {
                console.log('Keeping server open. Press Ctrl+C to exit.\n');
            }, 1000);
        }
    });

    testProcess.on('error', (err) => {
        console.error('Failed to start test process:', err);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
    });
});

console.log('Starting Sitrec Test Viewer...');
