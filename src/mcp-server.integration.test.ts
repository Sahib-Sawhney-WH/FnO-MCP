import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsResultSchema, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Mock modules BEFORE importing the module that uses them
jest.unstable_mockModule('./api.js', () => ({
    makeApiCall: jest.fn()
}));

jest.unstable_mockModule('./entityManager.js', () => ({
    EntityManager: jest.fn().mockImplementation(() => ({
        findBestMatch: jest.fn().mockResolvedValue('CustomersV3'),
    }))
}));

// Import the mocked modules
const { makeApiCall } = await import('./api.js');
const { getServer } = await import('./mcp-server.js');

// --- TEST SUITE ---

describe('MCP Server Integration Tests', () => {
    let mcpServer: McpServer;
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;

    beforeEach(async () => {
        // Clear the mock's history before each test.
        jest.clearAllMocks();

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
        // Reset mocks after each test
        jest.clearAllMocks();
    });

    it('should list all available tools', async () => {
        const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema);

        expect(result.tools.length).toBeGreaterThan(0);
        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).toContain('odataQuery');
        expect(toolNames).toContain('createCustomer');
        expect(makeApiCall).not.toHaveBeenCalled();
    });

    it('should call getODataMetadata tool successfully', async () => {
        // Configure the mock's return value for this specific test
        (makeApiCall as jest.Mock).mockResolvedValue({
            content: [{ type: 'text', text: '<metadata>...</metadata>' }],
        });

        const result = await client.callTool({ 
            name: 'getODataMetadata',
            arguments: {}
        }) as CallToolResult;
        
        expect(makeApiCall).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/$metadata'),
            null,
            expect.any(Function)
        );
        
        expect(result.content).toBeDefined();
        const textContent = result.content?.[0] as TextContent;
        expect(textContent.type).toBe('text');
        expect(textContent.text).toBe('<metadata>...</metadata>');
    });

    it('should use EntityManager to correct entity name in odataQuery tool', async () => {
        // Configure the mock's return value for this specific test
        (makeApiCall as jest.Mock).mockResolvedValue({
            content: [{ type: 'text', text: '{"value": [{"id": 1}]}' }],
        });

        await client.callTool({
            name: 'odataQuery',
            arguments: { entity: 'customer' }
        });

        // Verify the mock was called correctly
        expect(makeApiCall).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/CustomersV3'),
            null,
            expect.any(Function)
        );
    });
});