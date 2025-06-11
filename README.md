# Dynamics 365 Finance & Operations MCP Server

This project is a TypeScript-based server that implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to provide a secure and efficient gateway to the Dynamics 365 Finance & Operations (F&O) OData API. It exposes various D365 F&O data entities and actions as a set of tools that can be consumed by Large Language Models (LLMs) or other MCP-compatible clients.

The server handles authentication with Azure AD, including caching the bearer token to optimize performance by avoiding re-authentication on every API call.

## Features

- **MCP Compliant:** Built using the official `@modelcontextprotocol/sdk`.
- **Authenticated:** Securely connects to the D365 F&O OData API using the OAuth 2.0 client credentials flow.
- **Efficient:** Automatically caches the authentication token and refreshes it only when it's about to expire.
- **Well-Structured:** The project is organized by concern, separating the Express server, MCP tool definitions, API communication layer, and authentication logic.
- **Extensible:** Easily add new tools to expose more D365 F&O entities or actions.

---

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- An Azure Active Directory (Azure AD) App Registration with permissions to access your Dynamics 365 F&O environment.
- Your D365 F&O environment URL.

---

## Setup and Installation

Follow these steps to get the server up and running.

### 1. Get the Code

Clone or download this repository to your local machine.

### 2. Create the Environment File

Create a file named `.env` in the root directory of the project. This file will store your secret credentials. Populate it with your Azure AD and Dynamics 365 details.

**`.env` file example:**
```
# .env

# Azure AD and App Registration Details
TENANT_ID=your-azure-ad-tenant-id
CLIENT_ID=your-application-client-id
CLIENT_SECRET=your-client-secret-value

# Dynamics 365 F&O Environment URL
DYNAMICS_RESOURCE_URL=[https://your-d365-environment.operations.dynamics.com](https://your-d365-environment.operations.dynamics.com)

# Optional Port for the server
# PORT=3000
```

### 3. Install Dependencies

Open a terminal in the project's root directory and run:

```bash
npm install
```

---

## Running the Server

You can run the server in two modes:

### Development Mode

For development, use the `dev` script. This uses `tsx` to run the server with hot-reloading, automatically restarting it when you make changes to the source code.

```bash
npm run dev
```

### Production Mode

For a production environment, you should first build the TypeScript code into JavaScript and then run the compiled output.

1.  **Build the project:**
    ```bash
    npm run build
    ```
    This will compile the `src` directory into a `dist` directory.

2.  **Start the server:**
    ```bash
    npm run start
    ```

Once running, the server will be available at `http://localhost:3000` (or the port you specify in the `.env` file). The MCP endpoint is `http://localhost:3000/mcp`.

---

## Project Architecture

The server code is organized into several files within the `src/` directory to promote separation of concerns:

-   **`index.ts`**: The main entry point of the application. It's responsible for setting up and starting the Express web server and handling incoming MCP requests.
-   **`mcp-server.ts`**: Defines the MCP server itself and registers all the available tools that wrap the Dynamics 365 API endpoints.
-   **`api.ts`**: Acts as a service layer or gateway for all communication with the external Dynamics 365 OData API. It contains the `makeApiCall` helper function.
-   **`auth.ts`**: Contains the `AuthManager` class, which is responsible for the entire authentication lifecycle, including fetching and caching the bearer token.

---

## Available Tools

This MCP server exposes the following tools. An MCP client can call these to interact with Dynamics 365.

| Tool Name                       | Description                                                                                              | Arguments                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `odataQuery`                    | Executes a generic GET request against any D365 OData entity.                                            | `entity`, `select` (opt), `filter` (opt), `expand` (opt), `top` (opt), `crossCompany` (opt)                           |
| `getEntityCount`                | Gets the total count of records for a given entity.                                                      | `entity`, `crossCompany` (opt)                                                                                      |
| `getODataMetadata`              | Retrieves the OData $metadata document for the service.                                                  | _None_                                                                                                              |
| `createCustomer`                | Creates a new customer record in the `CustomersV3` entity.                                               | `customerData` (JSON object)                                                                                        |
| `updateCustomer`                | Updates an existing customer record.                                                                     | `dataAreaId`, `customerAccount`, `updateData` (JSON object)                                                         |
| `createSystemUser`              | Creates a new system user record.                                                                        | `userData` (JSON object)                                                                                            |
| `assignUserRole`                | Assigns a security role to a user.                                                                       | `associationData` (JSON object)                                                                                     |
| `updatePositionHierarchy`       | Updates a position in the hierarchy.                                                                     | `positionId`, `hierarchyTypeName`, `validFrom`, `validTo`, `updateData` (JSON object)                               |
| `action_initializeDataManagement` | Executes a specific OData action to initialize the data management framework.                          | _None_                                                                                                              |

---

## Extending the Server (Adding a New Tool)

Adding a new tool is straightforward.

1.  Open `src/mcp-server.ts`.
2.  Inside the `getServer` function, add a new `server.tool()` definition.
3.  Follow the existing pattern:
    -   Provide a `toolName`.
    -   Provide a `description` for the LLM.
    -   Define the `arguments` schema using `zod`.
    -   In the callback function, call the `makeApiCall` helper from `api.ts` with the correct method, URL, and body.

**Example: Adding a tool to get Vendor Groups**

```typescript
// Inside src/mcp-server.ts, within the getServer function

server.tool(
    'getVendorGroups',
    'Retrieves a list of all vendor groups.',
    {
        crossCompany: z.boolean().optional().describe("Set to true to query across all companies."),
    },
    async ({ crossCompany }, { sendNotification }) => {
         const url = new URL(`${process.env.DYNAMICS_RESOURCE_URL}/data/VendorGroups`);
         if (crossCompany) url.searchParams.append('cross-company', 'true');
         return makeApiCall('GET', url.toString(), null, sendNotification);
    }
);
```
`