import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsResultSchema, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getServer } from './mcp-server.js';
import * as api from './api.js'; // Import the entire module as a namespace

// Mock the EntityManager to control its behavior
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
    let makeApiCallSpy: jest.SpyInstance;

    beforeEach(async () => {
        // Use jest.spyOn to mock the makeApiCall function.
        // Provide a default mock implementation that does nothing.
        makeApiCallSpy = jest.spyOn(api, 'makeApiCall').mockImplementation(async () => {
            return { content: [{ type: 'text', text: 'Default mock response' }] };
        });

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
        // Restore the original function after each test to ensure test isolation
        makeApiCallSpy.mockRestore();
    });

    it('should list all available tools', async () => {
        const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema);

        expect(result.tools.length).toBeGreaterThan(0);
        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).toContain('odataQuery');
        expect(toolNames).toContain('createCustomer');
        // This test does not call the API, so the spy should not be called.
        expect(makeApiCallSpy).not.toHaveBeenCalled();
    });

    it('should call getODataMetadata tool successfully', async () => {
        // Mock a specific response for this test case
        makeApiCallSpy.mockResolvedValue({
            content: [{ type: 'text', text: '<metadata>...</metadata>' }],
        });

        const result = await client.callTool({ 
            name: 'getODataMetadata',
            arguments: {}
        }) as CallToolResult;
        
        expect(makeApiCallSpy).toHaveBeenCalledWith(
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
        makeApiCallSpy.mockResolvedValue({
            content: [{ type: 'text', text: '{"value": [{"id": 1}]}' }],
        });

        await client.callTool({
            name: 'odataQuery',
            arguments: { entity: 'customer' }
        });

        // Verify that the spy was called with the *corrected* entity name
        expect(makeApiCallSpy).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/CustomersV3'),
            null,
            expect.any(Function)
        );
    });
});