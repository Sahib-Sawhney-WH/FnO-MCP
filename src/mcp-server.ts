import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { makeApiCall } from './api.js';
import { EntityManager } from './entityManager.js';


const entityManager = new EntityManager();

/**
 * Creates and configures the MCP server with all the tools for the D365 API. 
 * @returns {McpServer} The configured McpServer instance. 
 */
export const getServer = (): McpServer => {
    const server = new McpServer({
        // ... (server configuration remains the same)
    });

    // --- Tool Definitions ---

    server.tool(
        'odataQuery',
        'Executes a generic GET request against a Dynamics 365 OData entity. The entity name does not need to be case-perfect.', // Updated description
        {
            entity: z.string().describe("The OData entity set to query (e.g., CustomersV3, ReleasedProductsV2)."),
            select: z.string().optional().describe("OData $select query parameter."),
            filter: z.string().optional().describe("OData $filter query parameter."),
            expand: z.string().optional().describe("OData $expand query parameter."),
            top: z.number().optional().describe("OData $top query parameter."),
            crossCompany: z.boolean().optional().describe("Set to true to query across all companies."),
        },
        async (args, { sendNotification }) => {
            
            const correctedEntity = await entityManager.findBestMatch(args.entity);

            if (!correctedEntity) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: `Could not find a matching entity for '${args.entity}'. Please provide a more specific name.` }]
                };
            }
            
            await sendNotification({
                method: "notifications/message",
                params: { level: "info", data: `Corrected entity name from '${args.entity}' to '${correctedEntity}'.` }
            });

            
            const { entity, ...queryParams } = args;
            const url = new URL(`${process.env.DYNAMICS_RESOURCE_URL}/data/${correctedEntity}`);

            if (queryParams.crossCompany) url.searchParams.append('cross-company', 'true');
            if (queryParams.select) url.searchParams.append('$select', queryParams.select);
            if (queryParams.filter) url.searchParams.append('$filter', queryParams.filter);
            if (queryParams.expand) url.searchParams.append('$expand', queryParams.expand);
            if (queryParams.top) url.searchParams.append('$top', queryParams.top.toString());

            return makeApiCall('GET', url.toString(), null, sendNotification); [cite: 1987]
        }
    );
    
    server.tool(
        'createCustomer',
        'Creates a new customer record in CustomersV3.',
        {
            customerData: z.record(z.unknown()).describe("A JSON object for the new customer. Must include dataAreaId, CustomerAccount, etc."),
        },
        async ({ customerData }, { sendNotification }) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/CustomersV3`;
            return makeApiCall('POST', url, customerData, sendNotification);
        }
    );

    server.tool(
        'updateCustomer',
        'Updates an existing customer record in CustomersV3 using a PATCH request.',
        {
            dataAreaId: z.string().describe("The dataAreaId of the customer (e.g., 'usmf')."),
            customerAccount: z.string().describe("The customer account ID to update (e.g., 'PM-001')."),
            updateData: z.record(z.unknown()).describe("A JSON object with the fields to update."),
        },
        async ({ dataAreaId, customerAccount, updateData }, { sendNotification }) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/CustomersV3(dataAreaId='${dataAreaId}',CustomerAccount='${customerAccount}')`;
            return makeApiCall('PATCH', url, updateData, sendNotification);
        }
    );

    server.tool(
        'getEntityCount',
        'Gets the total count of records for a given OData entity.',
        {
            entity: z.string().describe("The OData entity set to count (e.g., CustomersV3)."),
            crossCompany: z.boolean().optional().describe("Set to true to count across all companies."),
        },
        async ({ entity, crossCompany }, { sendNotification }) => {
             const url = new URL(`${process.env.DYNAMICS_RESOURCE_URL}/data/${entity}/$count`);
             if (crossCompany) url.searchParams.append('cross-company', 'true');
             return makeApiCall('GET', url.toString(), null, sendNotification);
        }
    );
    
    server.tool(
        'createSystemUser',
        'Creates a new user in SystemUsers.',
        {
            userData: z.record(z.unknown()).describe("A JSON object for the new system user. Must include UserID, Alias, Company, etc."),
        },
        async ({ userData }, { sendNotification }) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/SystemUsers`;
            return makeApiCall('POST', url, userData, sendNotification);
        }
    );

    server.tool(
        'assignUserRole',
        'Assigns a security role to a user in SecurityUserRoleAssociations.',
        {
            associationData: z.record(z.unknown()).describe("JSON object for the role association. Must include UserId and SecurityRoleIdentifier."),
        },
        async ({ associationData }, { sendNotification }) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/SecurityUserRoleAssociations`;
            return makeApiCall('POST', url, associationData, sendNotification);
        }
    );

    server.tool(
        'updatePositionHierarchy',
        'Updates a position in PositionHierarchies.',
        {
            positionId: z.string().describe("The ID of the position to update."),
            hierarchyTypeName: z.string().describe("The hierarchy type name (e.g., 'Line')."),
            validFrom: z.string().datetime().describe("The start validity date in ISO 8601 format."),
            validTo: z.string().datetime().describe("The end validity date in ISO 8601 format."),
            updateData: z.record(z.unknown()).describe("A JSON object with the fields to update (e.g., ParentPositionId)."),
        },
        async ({ positionId, hierarchyTypeName, validFrom, validTo, updateData }, { sendNotification }) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/PositionHierarchies(PositionId='${positionId}',HierarchyTypeName='${hierarchyTypeName}',ValidFrom=${validFrom},ValidTo=${validTo})`;
            return makeApiCall('PATCH', url, updateData, sendNotification);
        }
    );
    
    server.tool(
        'action_initializeDataManagement',
        'Executes the InitializeDataManagement action on the DataManagementDefinitionGroups entity.',
        {},
        async (_args, { sendNotification }) => {
            const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/DataManagementDefinitionGroups/Microsoft.Dynamics.DataEntities.InitializeDataManagement`;
            return makeApiCall('POST', url, {}, sendNotification);
        }
    );
    
    server.tool(
        'getODataMetadata',
        'Retrieves the OData $metadata document for the service.',
        {},
        async (_args, { sendNotification }) => {
             const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/$metadata`;
             return makeApiCall('GET', url.toString(), null, sendNotification);
        }
    );

    return server;
};
