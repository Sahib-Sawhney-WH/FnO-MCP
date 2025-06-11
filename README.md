Of course. I have updated your `README.md` to reflect the new fuzzy-matching capability for the `odataQuery` tool and the new `entityManager.ts` file in the architecture.

Here is the updated README:

-----

# Dynamics 365 Finance & Operations MCP Server

[cite\_start]This project is a TypeScript-based server that implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to provide a secure and efficient gateway to the Dynamics 365 Finance & Operations (F\&O) OData API[cite: 1870]. [cite\_start]It exposes various D365 F\&O data entities and actions as a set of tools that can be consumed by Large Language Models (LLMs) or other MCP-compatible clients[cite: 1871].

[cite\_start]The server handles authentication with Azure AD, including caching the bearer token to optimize performance by avoiding re-authentication on every API call[cite: 1872].

## Features

  - [cite\_start]**MCP Compliant:** Built using the official `@modelcontextprotocol/sdk`[cite: 1873].
  - [cite\_start]**Authenticated:** Securely connects to the D365 F\&O OData API using the OAuth 2.0 client credentials flow[cite: 1873].
  - [cite\_start]**Efficient:** Automatically caches the authentication token and refreshes it only when it's about to expire[cite: 1874]. It also caches the OData entity list to provide fast and fuzzy matching on entity names.
  - **User-Friendly:** The `odataQuery` tool uses a string-similarity algorithm to find the correct entity, even if the user's input has the wrong case or is slightly misspelled.
  - [cite\_start]**Well-Structured:** The project is organized by concern, separating the Express server, MCP tool definitions, API communication layer, and authentication logic[cite: 1875].
  - [cite\_start]**Extensible:** Easily add new tools to expose more D365 F\&O entities or actions[cite: 1876].

-----

## Prerequisites

  - [cite\_start][Node.js](https://nodejs.org/) (v18 or later recommended) [cite: 1877]
  - [cite\_start]An Azure Active Directory (Azure AD) App Registration with permissions to access your Dynamics 365 F\&O environment[cite: 1877].
  - [cite\_start]Your D365 F\&O environment URL[cite: 1878].

-----

## Setup and Installation

Follow these steps to get the server up and running.

### 1\. Get the Code

[cite\_start]Clone or download this repository to your local machine[cite: 1879].

### 2\. Create the Environment File

[cite\_start]Create a file named `.env` in the root directory of the project[cite: 1880]. [cite\_start]This file will store your secret credentials[cite: 1881]. [cite\_start]Populate it with your Azure AD and Dynamics 365 details[cite: 1881].

**`.env` file example:**

```
# .env

# Azure AD and App Registration Details
TENANT_ID=your-azure-ad-tenant-id
CLIENT_ID=your-application-client-id
CLIENT_SECRET=your-client-secret-value

# Dynamics 365 F&O Environment URL
DYNAMICS_RESOURCE_URL=https://your-d365-environment.operations.dynamics.com

# Optional Port for the server
# PORT=3000
```

### 3\. Install Dependencies

Open a terminal in the project's root directory and run:

```bash
npm install
```

-----

## Running the Server

You can run the server in two modes:

### Development Mode

[cite\_start]For development, use the `dev` script[cite: 1883]. [cite\_start]This uses `tsx` to run the server with hot-reloading, automatically restarting it when you make changes to the source code[cite: 1883].

```bash
npm run dev
```

### Production Mode

[cite\_start]For a production environment, you should first build the TypeScript code into JavaScript and then run the compiled output[cite: 1885].

1.  **Build the project:**
    ```bash
    npm run build
    ```
    [cite\_start]This will compile the `src` directory into a `dist` directory[cite: 1885].
2.  **Start the server:**
    ```bash
    npm run start
    ```

Once running, the server will be available at `http://localhost:3000` (or the port you specify in the `.env` file). [cite\_start]The MCP endpoint is `http://localhost:3000/mcp`[cite: 1887].

-----

## Project Architecture

The server code is organized into several files within the `src/` directory to promote separation of concerns:

  - [cite\_start]**`index.ts`**: The main entry point of the application[cite: 1888]. [cite\_start]It's responsible for setting up and starting the Express web server and handling incoming MCP requests[cite: 1888].
  - [cite\_start]**`mcp-server.ts`**: Defines the MCP server itself and registers all the available tools that wrap the Dynamics 365 API endpoints[cite: 1889].
  - [cite\_start]**`api.ts`**: Acts as a service layer or gateway for all communication with the external Dynamics 365 OData API[cite: 1890]. [cite\_start]It contains the `makeApiCall` helper function[cite: 1891].
  - [cite\_start]**`auth.ts`**: Contains the `AuthManager` class, which is responsible for the entire authentication lifecycle, including fetching and caching the bearer token[cite: 1892].
  - **`entityManager.ts`**: Contains the `EntityManager` class, which handles fetching, caching, and fuzzy-matching OData entity names to improve usability.

-----

## Available Tools

This MCP server exposes the following tools. An MCP client can call these to interact with Dynamics 365.

| Tool Name | Description | Arguments |
| --- | --- | --- |
| `odataQuery` | Executes a generic GET request against any D365 OData entity. The entity name does not need to be case-perfect. | `entity`, `select` (opt), `filter` (opt), `expand` (opt), `top` (opt), `crossCompany` (opt) |
| `getEntityCount` | [cite\_start]Gets the total count of records for a given entity[cite: 1901]. | [cite\_start]`entity`, `crossCompany` (opt) [cite: 1902] |
| `getODataMetadata` | [cite\_start]Retrieves the OData $metadata document for the service[cite: 1904]. | [cite\_start]*None* [cite: 1905] |
| `createCustomer` | [cite\_start]Creates a new customer record in the `CustomersV3` entity[cite: 1907]. | [cite\_start]`customerData` (JSON object) [cite: 1908] |
| `updateCustomer` | [cite\_start]Updates an existing customer record[cite: 1910]. | [cite\_start]`dataAreaId`, `customerAccount`, `updateData` (JSON object) [cite: 1910] |
| `createSystemUser` | [cite\_start]Creates a new system user record[cite: 1912]. | [cite\_start]`userData` (JSON object) [cite: 1912] |
| `assignUserRole` | [cite\_start]Assigns a security role to a user[cite: 1914]. | [cite\_start]`associationData` (JSON object) [cite: 1914] |
| `updatePositionHierarchy` | Updates a position in the hierarchy. | [cite\_start]`positionId`, `hierarchyTypeName`, `validFrom`, `validTo`, `updateData` (JSON object) [cite: 1916] |
| `action_initializeDataManagement` | [cite\_start]Executes a specific OData action to initialize the data management framework[cite: 1917]. | [cite\_start]*None* [cite: 1918] |

-----

## Extending the Server (Adding a New Tool)

Adding a new tool is straightforward.

1.  [cite\_start]Open `src/mcp-server.ts`[cite: 1921].
2.  [cite\_start]Inside the `getServer` function, add a new `server.tool()` definition[cite: 1922].
3.  [cite\_start]Follow the existing pattern[cite: 1923]:
      - [cite\_start]Provide a `toolName`[cite: 1923].
      - [cite\_start]Provide a `description` for the LLM[cite: 1923].
      - [cite\_start]Define the `arguments` schema using `zod`[cite: 1924].
      - [cite\_start]In the callback function, call the `makeApiCall` helper from `api.ts` with the correct method, URL, and body[cite: 1925].

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