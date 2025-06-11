import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsResultSchema, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getServer } from './mcp-server.js';
import { makeApiCall } from './api.js';

// This is the key change. We create a mock function that will be called *by* our module mock.
const makeApiCallMock = jest.fn();

// Mock the api module. The mocked makeApiCall function will delegate its behavior to our mock above.
// This is the correct way to mock ES modules when you need to change behavior per-test.
jest.mock('./api.js', () => ({
    makeApiCall: (...args: any[]) => makeApiCallMock(...args),
}));

// Mock the EntityManager as before.
jest.mock('./entityManager.js', () => ({
    EntityManager: jest.fn().mockImplementation(() => ({
        findBestMatch: jest.fn().mockResolvedValue('CustomersV3'),
    })),
}));

describe('MCP Server Integration Tests', () => {
    let mcpServer: McpServer;
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;

    beforeEach(async () => {
        // Clear the mock's history before each test.
        makeApiCallMock.mockClear();

        // Get a fresh server instance
        mcpServer = getServer();

        // Create a client
        client = new Client({ name: 'test-client', version: '1.0.0' });

        // Create a linked pair of in-memory transports
        [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        // Connect the client and server
        await Promise.all([
            client.connect(clientTransport),
            mcpServer.connect(serverTransport),
        ]);
    });

    afterEach(() => {
        // No need for restore here as we're not using spies.
    });

    it('should list all available tools', async () => {
        const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema);

        expect(result.tools.length).toBeGreaterThan(0);
        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).toContain('odataQuery');
        expect(toolNames).toContain('createCustomer');
        // This test does not call the API, so the mock should not be called.
        expect(makeApiCallMock).not.toHaveBeenCalled();
    });

    it('should call getODataMetadata tool successfully', async () => {
        // Mock a specific response for this test case
        makeApiCallMock.mockResolvedValue({
            content: [{ type: 'text', text: '<metadata>...</metadata>' }],
        });

        const result = await client.callTool({ 
            name: 'getODataMetadata',
            arguments: {}
        }) as CallToolResult;
        
        expect(makeApiCallMock).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/$metadata'),
            null,
            expect.any(Function)
        );
        
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        const textContent = result.content?.[0] as TextContent;
        expect(textContent.type).toBe('text');
        expect(textContent.text).toBe('<metadata>...</metadata>');
    });

    it('should use EntityManager to correct entity name in odataQuery tool', async () => {
        // Mock a specific response for this test case
        makeApiCallMock.mockResolvedValue({
            content: [{ type: 'text', text: '{"value": [{"id": 1}]}' }],
        });

        await client.callTool({
            name: 'odataQuery',
            arguments: { entity: 'customer' }
        });

        // Verify that the mock was called with the *corrected* entity name
        expect(makeApiCallMock).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/CustomersV3'),
            null,
            expect.any(Function)
        );
    });
});
