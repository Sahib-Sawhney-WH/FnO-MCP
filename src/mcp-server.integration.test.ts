import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
// Added CallToolResult to the import for type assertion
import { ListToolsResultSchema, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getServer } from './mcp-server.js';
import * as api from './api.js';

// Mock the entire api module to prevent real API calls
jest.mock('./api.js', () => ({
    makeApiCall: jest.fn(),
}));

// Also mock the EntityManager to control its behavior
jest.mock('./entityManager.js', () => ({
    EntityManager: jest.fn().mockImplementation(() => ({
        findBestMatch: jest.fn().mockResolvedValue('CustomersV3'),
    })),
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe('MCP Server Integration Tests', () => {
    let mcpServer: McpServer;
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;

    beforeEach(async () => {
        // Reset mocks before each test
        mockedApi.makeApiCall.mockClear();

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

    it('should list all available tools', async () => {
        const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema);

        expect(result.tools.length).toBeGreaterThan(0);
        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).toContain('odataQuery');
        expect(toolNames).toContain('createCustomer');
    });

    it('should call getODataMetadata tool successfully', async () => {
        // Mock the response for this specific API call
        mockedApi.makeApiCall.mockResolvedValue({
            content: [{ type: 'text', text: '<metadata>...</metadata>' }],
        });

        // Use an explicit type cast on the result of the await expression
        const result = await client.callTool({ name: 'getODataMetadata' }) as CallToolResult;

        expect(mockedApi.makeApiCall).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/$metadata'), // Check that the correct endpoint is called
            null,
            expect.any(Function)
        );
        
        // Add checks for content existence and use a type assertion
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBe(1);
        const textContent = result.content[0] as TextContent;
        expect(textContent.type).toBe('text');
        expect(textContent.text).toBe('<metadata>...</metadata>');
    });

    it('should use EntityManager to correct entity name in odataQuery tool', async () => {
        mockedApi.makeApiCall.mockResolvedValue({
            content: [{ type: 'text', text: '{"value": [{"id": 1}]}' }],
        });

        await client.callTool({
            name: 'odataQuery',
            arguments: { entity: 'customer' } // Inexact name
        });

        // Verify that makeApiCall was called with the *corrected* entity name
        expect(mockedApi.makeApiCall).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/CustomersV3'), // Should be corrected
            null,
            expect.any(Function)
        );
    });
});