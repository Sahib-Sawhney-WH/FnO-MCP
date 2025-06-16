// src/mcp-server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeApiCall } from './api.js';
import { EntityManager } from './entityManager.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

const entityManager = new EntityManager();
// PAGINATION: Define a default page size to prevent oversized payloads.
const DEFAULT_PAGE_SIZE = 5;

// Helper function to safely send notifications
async function safeNotification(context: RequestHandlerExtra<ServerRequest, ServerNotification>, notification: any): Promise<void> {
    try {
        await context.sendNotification(notification);
    } catch (error) {
        // Silently ignore notification errors
        console.log('Notification failed (this is normal in test environments):', error);
    }
}

// --- NEW: Schema-Aware Filter Builder ---
/**
 * Builds an OData $filter string by looking up field types from the entity schema.
 * @param filterObject The key-value pairs for filtering.
 * @param schema The parsed schema for the entity.
 * @returns A correctly formatted OData filter string.
 */
function buildSmartFilterString(filterObject?: Record<string, string>, schema?: any | null): string | null {
    if (!filterObject || !schema || Object.keys(filterObject).length === 0) {
        return null;
    }

    const filterClauses = Object.entries(filterObject).map(([key, value]) => {
        // Find the corresponding field in the schema
        const schemaField = schema.fields.find((f: any) => f.name.toLowerCase() === key.toLowerCase());

        if (!schemaField) {
            // If field not in schema, fall back to simple string comparison
            console.warn(`Field '${key}' not found in schema for '${schema.name}'. Defaulting to string filter.`);
            return `${key} eq '${value}'`;
        }

        // Check if the type is an Enum (doesn't start with 'Edm.')
        if (schemaField.type.startsWith('Edm.')) {
            // It's a standard type like Edm.String, Edm.Decimal, Edm.Int64
            // For simplicity, we'll quote them all, but a real implementation
            // might handle numbers and booleans differently.
            return `${schemaField.name} eq '${value}'`;
        } else {
            // It's an Enum type (e.g., 'Microsoft.Dynamics.DataEntities.PurchStatus')
            // Construct the fully qualified enum value
            return `${schemaField.name} eq ${schemaField.type}'${value}'`;
        }
    });

    return filterClauses.join(' and ');
}

// --- Zod Schemas for Tool Arguments ---

const odataQuerySchema = z.object({
    entity: z.string().describe("The OData entity set to query (e.g., CustomersV3, ReleasedProductsV2)."),
    select: z.string().optional().describe("OData $select query parameter to limit the fields returned."),
    filter: z.record(z.string()).optional().describe("Key-value pairs for filtering. e.g., { ProductNumber: 'D0001', dataAreaId: 'usmf', PurchaseOrderStatus: 'Received' }."),
    expand: z.string().optional().describe("OData $expand query parameter."),
    // PAGINATION: Updated description for 'top' to explain its role in pagination.
    top: z.number().optional().describe(`The number of records to return per page. Defaults to ${DEFAULT_PAGE_SIZE}.`),
    // PAGINATION: Added 'skip' parameter for fetching subsequent pages.
    skip: z.number().optional().describe("The number of records to skip. Used for pagination to get the next set of results."),
    crossCompany: z.boolean().optional().describe("Set to true to query across all companies."),
});

const createCustomerSchema = z.object({
    customerData: z.record(z.unknown()).describe("A JSON object for the new customer. Must include dataAreaId, CustomerAccount, etc."),
});

const updateCustomerSchema = z.object({
    dataAreaId: z.string().describe("The dataAreaId of the customer (e.g., 'usmf')."),
    customerAccount: z.string().describe("The customer account ID to update (e.g., 'PM-001')."),
    updateData: z.record(z.unknown()).describe("A JSON object with the fields to update."),
});

const getEntityCountSchema = z.object({
    entity: z.string().describe("The OData entity set to count (e.g., CustomersV3)."),
    crossCompany: z.boolean().optional().describe("Set to true to count across all companies."),
});

const createSystemUserSchema = z.object({
     userData: z.record(z.unknown()).describe("A JSON object for the new system user. Must include UserID, Alias, Company, etc."),
});

const assignUserRoleSchema = z.object({
    associationData: z.record(z.unknown()).describe("JSON object for the role association. Must include UserId and SecurityRoleIdentifier."),
});

const updatePositionHierarchySchema = z.object({
    positionId: z.string().describe("The ID of the position to update."),
    hierarchyTypeName: z.string().describe("The hierarchy type name (e.g., 'Line')."),
    validFrom: z.string().datetime().describe("The start validity date in ISO 8601 format."),
    validTo: z.string().datetime().describe("The end validity date in ISO 8601 format."),
    updateData: z.record(z.unknown()).describe("A JSON object with the fields to update (e.g., ParentPositionId)."),
});

/**
 * Creates and configures the MCP server with all the tools for the D365 API.
 * @returns {McpServer} The configured McpServer instance.
 */
export const getServer = (): McpServer => {
    const server = new McpServer({
        name: 'd365-fno-mcp-server',
        version: '1.0.0',
    });

    // --- Tool Definitions ---

    server.tool(
        'odataQuery',
        'Executes a generic GET request against a Dynamics 365 OData entity. The entity name does not need to be case-perfect. Responses are paginated. It automatically handles Enum types in filters.',
        odataQuerySchema.shape,
        async (args: z.infer<typeof odataQuerySchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {

            const correctedEntity = await entityManager.findBestMatch(args.entity);

            if (!correctedEntity) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `Could not find a matching entity for '${args.entity}'. Please provide a more specific name.` }]
                };
            }

            // +++ NEW LOGIC: Get the schema for the entity +++
            const entitySchema = await entityManager.getEntitySchema(correctedEntity);
            if (entitySchema) {
                await safeNotification(context, {
                    method: "notifications/message",
                    params: { level: "info", data: `Found schema for '${correctedEntity}'. I will now build a smart filter.` }
                });
            } else {
                 await safeNotification(context, {
                    method: "notifications/message",
                    params: { level: "warn", data: `Could not find schema for '${correctedEntity}'. Falling back to simple filters.` }
                });
            }

            const effectiveArgs = { ...args };

            if (effectiveArgs.filter?.dataAreaId && effectiveArgs.crossCompany !== false) {
                if (!effectiveArgs.crossCompany) {
                    await safeNotification(context, {
                        method: "notifications/message",
                        params: { level: "info", data: `Filter on company ('dataAreaId') detected. Automatically enabling cross-company search.` }
                    });
                }
                effectiveArgs.crossCompany = true;
            }

            await safeNotification(context, {
                method: "notifications/message",
                params: { level: "info", data: `Corrected entity name from '${args.entity}' to '${correctedEntity}'.` }
            });

            const { entity, ...queryParams } = effectiveArgs;

            // --- MODIFIED: Use the new smart filter builder ---
            const filterString = buildSmartFilterString(queryParams.filter, entitySchema);

            const url = new URL(`${process.env.DYNAMICS_RESOURCE_URL}/data/${correctedEntity}`);
            // PAGINATION: Apply query parameters including the new skip and a default top.
            const topValue = queryParams.top || DEFAULT_PAGE_SIZE;
            url.searchParams.append('$top', topValue.toString());

            if (queryParams.skip) {
                url.searchParams.append('$skip', queryParams.skip.toString());
            }

            if (queryParams.crossCompany) url.searchParams.append('cross-company', 'true');
            if (queryParams.select) url.searchParams.append('$select', queryParams.select);
            if (filterString) url.searchParams.append('$filter', filterString);
            if (queryParams.expand) url.searchParams.append('$expand', queryParams.expand);

            return makeApiCall('GET', url.toString(), null, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'createCustomer',
        'Creates a new customer record in CustomersV3.',
        createCustomerSchema.shape,
        async ({ customerData }: z.infer<typeof createCustomerSchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/CustomersV3`;
            return makeApiCall('POST', url, customerData as Record<string, unknown>, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'updateCustomer',
        'Updates an existing customer record in CustomersV3 using a PATCH request.',
        updateCustomerSchema.shape,
        async ({ dataAreaId, customerAccount, updateData }: z.infer<typeof updateCustomerSchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/CustomersV3(dataAreaId='${dataAreaId}',CustomerAccount='${customerAccount}')`;
            return makeApiCall('PATCH', url, updateData as Record<string, unknown>, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'getEntityCount',
        'Gets the total count of records for a given OData entity.',
        getEntityCountSchema.shape,
        async ({ entity, crossCompany }: z.infer<typeof getEntityCountSchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
             const url = new URL(`${process.env.DYNAMICS_RESOURCE_URL}/data/${entity}/$count`);
             if (crossCompany) url.searchParams.append('cross-company', 'true');
             return makeApiCall('GET', url.toString(), null, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'createSystemUser',
        'Creates a new user in SystemUsers.',
        createSystemUserSchema.shape,
        async ({ userData }: z.infer<typeof createSystemUserSchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/SystemUsers`;
            return makeApiCall('POST', url, userData as Record<string, unknown>, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'assignUserRole',
        'Assigns a security role to a user in SecurityUserRoleAssociations.',
        assignUserRoleSchema.shape,
        async ({ associationData }: z.infer<typeof assignUserRoleSchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/SecurityUserRoleAssociations`;
            return makeApiCall('POST', url, associationData as Record<string, unknown>, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'updatePositionHierarchy',
        'Updates a position in PositionHierarchies.',
        updatePositionHierarchySchema.shape,
        async ({ positionId, hierarchyTypeName, validFrom, validTo, updateData }: z.infer<typeof updatePositionHierarchySchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/PositionHierarchies(PositionId='${positionId}',HierarchyTypeName='${hierarchyTypeName}',ValidFrom=${validFrom},ValidTo=${validTo})`;
            return makeApiCall('PATCH', url, updateData as Record<string, unknown>, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'action_initializeDataManagement',
        'Executes the InitializeDataManagement action on the DataManagementDefinitionGroups entity.',
        z.object({}).shape,
        async (_args: {}, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/DataManagementDefinitionGroups/Microsoft.Dynamics.DataEntities.InitializeDataManagement`;
            return makeApiCall('POST', url, {}, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    server.tool(
        'getODataMetadata',
        'Retrieves the OData $metadata document for the service.',
        z.object({}).shape,
        async (_args: {}, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
             const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/$metadata`;
             return makeApiCall('GET', url.toString(), null, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    return server;
};