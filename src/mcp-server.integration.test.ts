// src/mcp-server.integration.test.ts

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsResultSchema, TextContent, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Create mock functions
const mockMakeApiCall = jest.fn();
const mockFindBestMatch = jest.fn();
// --- NEW: Add a mock for the new getEntitySchema function ---
const mockGetEntitySchema = jest.fn();


// Mock modules BEFORE importing the module that uses them
jest.unstable_mockModule('./api.js', () => ({
    makeApiCall: mockMakeApiCall
}));

// --- MODIFIED: Update the EntityManager mock ---
jest.unstable_mockModule('./entityManager.js', () => ({
    EntityManager: jest.fn().mockImplementation(() => ({
        findBestMatch: mockFindBestMatch,
        // Add the new mock function here
        getEntitySchema: mockGetEntitySchema
    }))
}));

// Import after mocking
const { getServer } = await import('./mcp-server.js');

// --- TEST SUITE ---

describe('MCP Server Integration Tests', () => {
    let mcpServer: McpServer;
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;

    beforeEach(async () => {
        // Set up required environment variables
        process.env.DYNAMICS_RESOURCE_URL = 'https://test.dynamics.com';

        // Clear all mocks
        jest.clearAllMocks();

        // Reset mock implementations
        mockFindBestMatch.mockResolvedValue('CustomersV3');
        mockMakeApiCall.mockResolvedValue({
            content: [{ type: 'text', text: '{"value": []}' }]
        });
        // --- NEW: Provide a default mock schema for tests ---
        mockGetEntitySchema.mockResolvedValue({
            name: 'CustomersV3',
            fields: [
                { name: 'dataAreaId', type: 'Edm.String' },
                { name: 'CustomerAccount', type: 'Edm.String' }
            ]
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
        // Reset mocks after each test
        jest.clearAllMocks();
    });

    it('should list all available tools', async () => {
        const result = await client.request({ method: 'tools/list' }, ListToolsResultSchema);

        expect(result.tools.length).toBeGreaterThan(0);
        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).toContain('odataQuery');
        expect(toolNames).toContain('createCustomer');
        expect(mockMakeApiCall).not.toHaveBeenCalled();
    });

    it('should call getODataMetadata tool successfully', async () => {
        // Configure the mock's return value for this specific test
        mockMakeApiCall.mockResolvedValue({
            content: [{ type: 'text', text: '<metadata>...</metadata>' }],
        });

        const result = await client.callTool({
            name: 'getODataMetadata',
            arguments: {}
        }) as CallToolResult;

        expect(mockMakeApiCall).toHaveBeenCalledWith(
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
        mockMakeApiCall.mockResolvedValue({
            content: [{ type: 'text', text: '{"value": [{"id": 1}]}' }],
        });

        const result = await client.callTool({
            name: 'odataQuery',
            arguments: { entity: 'customer' }
        }) as CallToolResult;

        // Verify EntityManager was called
        expect(mockFindBestMatch).toHaveBeenCalledWith('customer');
        // --- NEW: Verify the new function was called ---
        expect(mockGetEntitySchema).toHaveBeenCalledWith('CustomersV3');


        // Verify the mock was called correctly
        expect(mockMakeApiCall).toHaveBeenCalledWith(
            'GET',
            expect.stringContaining('/data/CustomersV3'),
            null,
            expect.any(Function)
        );

        // Verify the result
        expect(result.content).toBeDefined();
        const textContent = result.content?.[0] as TextContent;
        expect(textContent.text).toContain('"id": 1');
    });
});