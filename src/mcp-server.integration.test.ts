import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsResultSchema, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getServer } from './mcp-server.js';
import * as api from './api.js'; // Import the entire module as a namespace

// --- MOCK SETUP ---

// 1. Mock the entire 'api.js' module. This must be at the top level.
jest.mock('./api.js');

// 2. Mock the EntityManager as before.
jest.mock('./entityManager.js', () => ({
    EntityManager: jest.fn().mockImplementation(() => ({
        findBestMatch: jest.fn().mockResolvedValue('CustomersV3'),
    })),
}));

// 3. For type safety, cast the imported function to jest.Mock within the tests.
const mockedMakeApiCall = api.makeApiCall as jest.Mock;


// --- TEST SUITE ---

describe('MCP Server Integration Tests', () => {
    let mcpServer: McpServer;
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;

    beforeEach(async () => {
        // Clear the mock's history before each test.
        mockedMakeApiCall.mockClear();

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
        // No need to restore spies, as we are using jest.mock()
    });

    it('should list all available tools', async () => {
        const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema);

        expect(result.tools.length).toBeGreaterThan(0);
        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).toContain('odataQuery');
        expect(toolNames).toContain('createCustomer');
        expect(mockedMakeApiCall).not.toHaveBeenCalled();
    });

    it('should call getODataMetadata tool successfully', async () => {
        // Configure the mock's return value for this specific test
        mockedMakeApiCall.mockResolvedValue({
            content: [{ type: 'text', text: '<metadata>...</metadata>' }],
        });

        const result = await client.callTool({ 
            name: 'getODataMetadata',
            arguments: {}
        }) as CallToolResult;
        
        expect(mockedMakeApiCall).toHaveBeenCalledWith(
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
        mockedMakeApiCall.mockResolvedValue({
            content: [{ type: 'text', text: '{"value": [{"id": 1}]}' }],
        });

        await client.callTool({
            name: 'odataQuery',
            arguments: { entity: 'customer' }
        });

        // Verify the mock was called correctly
        expect(mockedMakeApiCall).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/CustomersV3'),
            null,
            expect.any(Function)
        );
    });
});
