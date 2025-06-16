// src/mcp-server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { makeApiCall } from './api.js';
import { EntityManager } from './entityManager.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

const entityManager = new EntityManager();
const DEFAULT_PAGE_SIZE = 5;

async function safeNotification(context: RequestHandlerExtra<ServerRequest, ServerNotification>, notification: any): Promise<void> {
    try {
        await context.sendNotification(notification);
    } catch (error) {
        console.log('Notification failed (this is normal in test environments):', error);
    }
}

function buildSmartFilterString(filterObject?: Record<string, string>, schema?: any | null): string | null {
    if (!filterObject || !schema || Object.keys(filterObject).length === 0) {
        return null;
    }

    const filterClauses = Object.entries(filterObject).map(([key, value]) => {
        const schemaField = schema.fields.find((f: any) => f.name.toLowerCase() === key.toLowerCase());

        if (!schemaField) {
            console.warn(`Field '${key}' not found in schema for '${schema.name}'. Defaulting to string filter.`);
            return `${key} eq '${value}'`;
        }

        if (schemaField.type.startsWith('Edm.')) {
            return `${schemaField.name} eq '${value}'`;
        } else {
            return `${schemaField.name} eq ${schemaField.type}'${value}'`;
        }
    });

    return filterClauses.join(' and ');
}

const odataQuerySchema = z.object({
    entity: z.string().describe("The OData entity set to query (e.g., CustomersV3, ReleasedProductsV2)."),
    select: z.string().optional().describe("OData $select query parameter to limit the fields returned."),
    filter: z.record(z.string()).optional().describe("Key-value pairs for filtering. e.g., { ProductNumber: 'D0001', PurchaseOrderStatus: 'Received' }."),
    expand: z.string().optional().describe("OData $expand query parameter."),
    top: z.number().optional().describe(`The number of records to return per page. Defaults to ${DEFAULT_PAGE_SIZE}.`),
    skip: z.number().optional().describe("The number of records to skip. Used for pagination to get the next set of results."),
    crossCompany: z.boolean().optional().describe("Set to true to query across all companies."),
    planOnly: z.boolean().optional().default(true).describe("Default is true. If true, returns the execution plan without running the query. Set to false to execute the query."),
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
 */
export const getServer = (): McpServer => {
    const server = new McpServer({
        name: 'd365-fno-mcp-server',
        version: '1.0.0',
    });

    // --- Tool Definitions ---

    server.tool(
        'odataQuery',
        'Executes a generic GET request against a Dynamics 365 OData entity. By default, it returns a plan; set planOnly=false to execute.',
        odataQuerySchema.shape,
        async (args: z.infer<typeof odataQuerySchema>, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {

            const correctedEntity = await entityManager.findBestMatch(args.entity);

            if (!correctedEntity) {
                return { isError: true, content: [{ type: 'text', text: `Could not find a matching entity for '${args.entity}'.` }] };
            }

            const entitySchema = await entityManager.getEntitySchema(correctedEntity);
            
            if (!entitySchema) {
                const errorMsg = `Could not find a schema for entity '${correctedEntity}'. This can happen if the entity set name differs from its type name. Please check the server logs for a list of all available schema keys that were successfully parsed.`;
                return { isError: true, content: [{ type: 'text', text: errorMsg }] };
            }

            const effectiveArgs = { ...args };
            if (effectiveArgs.filter?.dataAreaId && effectiveArgs.crossCompany !== false) {
                effectiveArgs.crossCompany = true;
            }

            const { entity, planOnly, ...queryParams } = effectiveArgs;
            const filterString = buildSmartFilterString(queryParams.filter, entitySchema);
            const url = new URL(`${process.env.DYNAMICS_RESOURCE_URL}/data/${correctedEntity}`);
            const topValue = queryParams.top || DEFAULT_PAGE_SIZE;
            url.searchParams.append('$top', topValue.toString());
            if (queryParams.skip) url.searchParams.append('$skip', queryParams.skip.toString());
            if (queryParams.crossCompany) url.searchParams.append('cross-company', 'true');
            if (queryParams.select) url.searchParams.append('$select', queryParams.select);
            if (filterString) url.searchParams.append('$filter', filterString);
            if (queryParams.expand) url.searchParams.append('$expand', queryParams.expand);

            let planOutput = '## OData Query Plan\n\n';
            planOutput += `**Full URL:**\n\`\`\`\n${url.toString()}\n\`\`\`\n\n`;
            planOutput += '**Filter Analysis:**\n';

            if (args.filter && Object.keys(args.filter).length > 0) {
                planOutput += '| Value Provided | Mapped to Field | Detected Type |\n';
                planOutput += '|----------------|-----------------|---------------|\n';
                for (const [key, value] of Object.entries(args.filter)) {
                    const schemaField = entitySchema.fields.find(f => f.name.toLowerCase() === key.toLowerCase());
                    const fieldName = schemaField?.name || key;
                    const fieldType = schemaField?.type || 'Unknown';
                    planOutput += `| \`${value}\` | \`${fieldName}\` | \`${fieldType}\` |\n`;
                }
            } else {
                planOutput += '_No filters were provided._\n';
            }
            
            planOutput += "\nTo execute this query, call the tool again with the same parameters and `\"planOnly\": false`.";

            if (planOnly) {
                return { content: [{ type: 'text', text: planOutput }] };
            }

            await safeNotification(context, {
                method: "notifications/message",
                params: { level: "info", data: `Executing query against: ${url.toString()}` }
            });

            return makeApiCall('GET', url.toString(), null, async (notification) => {
                await safeNotification(context, notification);
            });
        }
    );

    // --- All other tools must be defined BEFORE the final return statement ---

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

    // The final return must be at the end of the function.
    return server;
};