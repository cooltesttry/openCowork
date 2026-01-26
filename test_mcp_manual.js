
const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.resolve('/Users/huawang/pyproject/openCowork/simple-crawler/dist/mcp-server.js');
const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit']
});

console.log('Sending initialize request...');

// MCP Initialize Request
const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
            name: 'manual-test',
            version: '1.0.0'
        }
    }
};

server.stdin.write(JSON.stringify(initRequest) + '\n');

// Listen for responses
server.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());

    for (const line of lines) {
        try {
            const response = JSON.parse(line);
            console.log('Received response:', JSON.stringify(response, null, 2));

            if (response.id === 1) {
                console.log('Initialize successful. Sending initialized notification and tools/list...');

                // Send initialized notification
                server.stdin.write(JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'notifications/initialized'
                }) + '\n');

                // Send tools/list request
                const toolsRequest = {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list'
                };
                server.stdin.write(JSON.stringify(toolsRequest) + '\n');
            } else if (response.id === 2) {
                console.log('Tools list received!');
                if (response.result && response.result.tools) {
                    console.log('Found tools:', response.result.tools.map(t => t.name));
                }
                server.kill();
                process.exit(0);
            }
        } catch (e) {
            console.log('Non-JSON output:', line);
        }
    }
});

server.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
});
