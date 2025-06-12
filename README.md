# Dynamics 365 Finance & Operations MCP Server

This project is a TypeScript-based server that implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to provide a secure and efficient gateway to the Dynamics 365 Finance & Operations (F&O) OData API. It exposes various D365 F&O data entities and actions as a set of tools that can be consumed by Large Language Models (LLMs), Microsoft Copilot Studio, or other MCP-compatible clients.

The server handles authentication with Azure AD, including caching the bearer token to optimize performance by avoiding re-authentication on every API call.

## Features

-   **MCP Compliant:** Built using the official `@modelcontextprotocol/sdk`.
-   **Authenticated:** Securely connects to the D365 F&O OData API using the OAuth 2.0 client credentials flow.
-   **Efficient:** Automatically caches the authentication token and refreshes it only when it's about to expire. It also caches the OData entity list for fast lookups.
-   **User-Friendly:** The `odataQuery` tool uses a fuzzy-matching algorithm (`fuse.js`) to find the correct entity, even if the user's input has the wrong case or is slightly misspelled.
-   **Well-Structured:** The project is organized by concern, separating the Express server, MCP tool definitions, API communication layer, and authentication logic.
-   **Tested:** Includes a testing suite with Jest for unit and integration tests to ensure reliability and maintainability.
-   **Extensible:** Easily add new tools to expose more D365 F&O entities or actions.

---

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later recommended)
-   An Azure Active Directory (Azure AD) App Registration with permissions to access your Dynamics 365 F&O environment.
-   Your D365 F&O environment URL.

---

## Setup and Installation

Follow these steps to get the server up and running.

### 1. Get the Code

Clone this repository to your local machine.

```bash
git clone <repository-url>
cd <repository-directory>
```

### 2. Configure Environment Variables

This project uses a `.env` file to manage secret credentials.

1.  **Create a `.env` file** by copying the example template:
    ```bash
    cp .env.example .env
    ```

2.  **Edit the `.env` file** and populate it with your Azure AD and Dynamics 365 details.

    ```dotenv
    # .env - Your secret credentials

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

## Testing Strategy

This project uses [Jest](https://jestjs.io/) as its testing framework. Tests are located alongside the source files they are testing (e.g., `auth.test.ts` tests `auth.ts`).

The testing strategy includes:
-   **Unit Tests:** To test individual modules, like the `AuthManager`, in isolation. These tests use mocking to simulate external dependencies like `fetch`.
-   **Integration Tests:** To test how different parts of the MCP server work together. These tests use the SDK's `InMemoryTransport` to simulate a client-server connection without making real network calls, allowing for fast and reliable verification of tool definitions and behaviors.

### Running Tests

To run the entire test suite, execute the following command:

```bash
npm test
```

---

## Project Architecture

The server code is organized into several files within the `src/` directory to promote separation of concerns:

-   **`index.ts`**: The main entry point of the application. It's responsible for setting up and starting the Express web server and handling incoming MCP requests.
-   **`mcp-server.ts`**: Defines the MCP server itself and registers all the available tools that wrap the Dynamics 365 API endpoints.
-   **`api.ts`**: Acts as a service layer or gateway for all communication with the external Dynamics 365 OData API. It contains the `makeApiCall` helper function.
-   **`auth.ts`**: Contains the `AuthManager` class, which is responsible for the entire authentication lifecycle, including fetching and caching the bearer token.
-   **`entityManager.ts`**: Contains the `EntityManager` class, which handles fetching, caching, and fuzzy-matching OData entity names to improve usability.

---

## Available Tools

This MCP server exposes the following tools. An MCP client can call these to interact with Dynamics 365.

| Tool Name                       | Description                                                                                                | Arguments                                                                                                           |
| :------------------------------ | :--------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `odataQuery`                    | Executes a generic GET request against any D365 OData entity. The entity name does not need to be case-perfect. It also smartly enables cross-company search if `dataAreaId` is part of the filter. | `entity`, `select` (opt), `filter` (opt), `expand` (opt), `top` (opt), `crossCompany` (opt)                           |
| `getEntityCount`                | Gets the total count of records for a given entity.                                                        | `entity`, `crossCompany` (opt)                                                                                      |
| `getODataMetadata`              | Retrieves the OData $metadata document for the service.                                                    | _None_                                                                                                              |
| `createCustomer`                | Creates a new customer record in the `CustomersV3` entity.                                                 | `customerData` (JSON object)                                                                                        |
| `updateCustomer`                | Updates an existing customer record.                                                                       | `dataAreaId`, `customerAccount`, `updateData` (JSON object)                                                         |
| `createSystemUser`              | Creates a new system user record.                                                                          | `userData` (JSON object)                                                                                            |
| `assignUserRole`                | Assigns a security role to a user.                                                                         | `associationData` (JSON object)                                                                                     |
| `updatePositionHierarchy`       | Updates a position in the hierarchy.                                                                       | `positionId`, `hierarchyTypeName`, `validFrom`, `validTo`, `updateData` (JSON object)                               |
| `action_initializeDataManagement` | Executes a specific OData action to initialize the data management framework.                            | _None_                                                                                                              |

---

## Extending the Server (Adding a New Tool)

Adding a new tool is straightforward.

1.  Open `src/mcp-server.ts`.
2.  Inside the `getServer` function, add a new `server.tool()` definition.
3.  Follow the existing pattern:
    -   Provide a `toolName`.
    -   Provide a `description` for the LLM.
    -   Define the `arguments` schema using `zod`.
    -   In the callback function, use the `context` parameter to access `sendNotification` and other request-specific data. Call the `makeApiCall` helper from `api.ts` with the correct method, URL, and body.

**Example: Adding a tool to get Vendor Groups**

```typescript
// Inside src/mcp-server.ts, within the getServer function
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/server/protocol.js';
import { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

// ...

server.tool(
    'getVendorGroups',
    'Retrieves a list of all vendor groups.',
    {
        crossCompany: z.boolean().optional().describe("Set to true to query across all companies."),
    },
    async ({ crossCompany }, context: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
         const url = new URL(`${process.env.DYNAMICS_RESOURCE_URL}/data/VendorGroups`);
         if (crossCompany) url.searchParams.append('cross-company', 'true');
         return makeApiCall('GET', url.toString(), null, context.sendNotification);
    }
);
```

---

## Security Considerations

-   **Secrets Management**: The `.env` file contains sensitive credentials (`CLIENT_ID`, `CLIENT_SECRET`, etc.). This file should **never** be committed to source control. Ensure your `.gitignore` file includes `.env`.
-   **Azure Deployment**: When deploying to Azure, use the **Configuration > Application settings** panel to store your secrets. These are securely injected as environment variables at runtime and are not stored in your code repository.
-   **Network Security**: For production environments, consider placing the Azure Web App behind a firewall or in a Virtual Network (VNet) and using private endpoints to restrict access.

---

## Deploying to Azure

You can deploy this application directly to an Azure Web App service. The repository includes a sample GitHub Actions workflow file at `.github/workflows/main_fno-mcp.yml` that can be adapted for your deployment pipeline.

### Step 1: Create an Azure Web App

First, you need to create the Web App resource in the Azure Portal.

1.  Go to the [Azure Portal](https://portal.azure.com) and click **Create a resource**.
2.  Search for "Web App" and click **Create**.
3.  Fill out the **Basics** tab with the following settings:
    -   **Subscription:** Choose your Azure subscription.
    -   **Resource Group:** Create a new one or select an existing one.
    -   **Name:** Give your app a globally unique name (e.g., `fno-mcp-server-yourname`). This name will form part of your URL.
    -   **Publish:** Select **Code**.
    -   **Runtime stack:** Select **Node 22 LTS**.
    -   **Operating System:** Select **Linux**.
    -   **Region:** Choose a region close to you.
4.  Configure the **App Service Plan** based on your needs (a Free F1 tier is sufficient for testing).
5.  Click **Review + create**, then **Create** to provision the resource. **Make a note of the default URL** (e.g., `https://fno-mcp-server-yourname.azurewebsites.net`).

### Step 2: Configure GitHub Deployment

Once the Web App is created, configure it to automatically deploy from your GitHub repository.

1.  Navigate to your newly created Web App resource in the Azure Portal.
2.  In the left-hand menu, under "Deployment", click on **Deployment Center**.
3.  For the **Source**, select **GitHub**.
4.  Authorize Azure to access your GitHub account if you haven't already.
5.  Configure the build settings:
    -   **Organization:** Select your GitHub username or organization.
    -   **Repository:** Select your `fno-mcp-server` repository.
    -   **Branch:** Select `main`.
6.  Azure will detect the Node.js project and suggest a workflow. Review the settings and click **Save**. This will commit a workflow file to your repository in the `.github/workflows/` directory. Any subsequent pushes to your `main` branch will automatically trigger a new deployment to your Azure Web App.

### Step 3: Configure Environment Variables in Azure

Your deployed application needs access to the same secrets as your local environment.

1.  In your Web App's menu, go to **Configuration** > **Application settings**.
2.  Under "Application settings", click **+ New application setting** to add each of the variables from your local `.env` file:
    -   `TENANT_ID`
    -   `CLIENT_ID`
    -   `CLIENT_SECRET`
    -   `DYNAMICS_RESOURCE_URL`
    -   `PORT` (optional, Azure provides this automatically but you can set it to `8080`)
3.  Click **Save**. The app will restart with the new settings.

### Step 4: Configure Session Affinity (Required)

This MCP server is **stateful**. It maintains an in-memory `transports` object to keep track of every active client session. For this to work correctly when the app is scaled across multiple instances, you must enable session affinity.

1.  In your Web App's menu, go to **Configuration** > **General settings**.
2.  Under the "Platform settings" tab, find the **Session affinity** setting.
3.  Set it to **On**.
4.  Click **Save**.

With these steps completed, your server will be running on Azure and will automatically update whenever you push changes to your `main` branch.

---

## Integrating with Microsoft Copilot Studio

Once your MCP server is deployed, you can register it as a **Custom Connector** to make its tools available to your copilot. This process is started in Copilot Studio and completed in Power Apps.

The process uses an **OpenAPI specification** file to describe your server's API.

### 1. Create the OpenAPI Definition File

First, create an OpenAPI (Swagger) definition that describes your server's single `/mcp` endpoint. The key property `x-ms-agentic-protocol: mcp-streamable-1.0` tells the platform that this endpoint speaks the Model Context Protocol.

Save the following YAML code as a file named `swagger.yaml` on your local machine.

**IMPORTANT:** You must replace the `host` value with the URL of your deployed Azure Web App.

```yaml
swagger: '2.0'
info:
  title: 'Dynamics 365 F&O MCP Server'
  description: 'Connects to a server that implements the Model Context Protocol (MCP) to provide a secure and efficient gateway to the Dynamics 365 Finance & Operations (F&O) OData API.'
  version: '1.0.0'
host: 'your-app-name.azurewebsites.net' # <-- IMPORTANT: REPLACE THIS
basePath: /
schemes:
  - https
paths:
  /mcp:
    post:
      summary: 'Invoke D365 F&O MCP Server'
      description: 'The single endpoint for all MCP communications.'
      x-ms-agentic-protocol: mcp-streamable-1.0
      operationId: 'InvokeMcpServer'
      consumes:
      - application/json
      produces:
      - application/json
      responses:
        '200':
          description: 'Successful MCP response.'
          schema:
            type: object
        default:
          description: 'Error response.'
          schema:
            type: object
```

### 2. Create the Custom Connector

1.  Navigate to your copilot in [Microsoft Copilot Studio](https://copilotstudio.microsoft.com/).
2.  Select **Topics & Plugins** in the left navigation.
3.  Select **+ Add a plugin**.
4.  Select **Add a custom connector**. You will be taken to the Power Apps portal to create the connector.
5.  On the Custom Connectors page in Power Apps, select **+ New custom connector**.
6.  From the dropdown, select **Import an OpenAPI file**.
7.  Provide a name for your connector (e.g., "D365 F&O MCP Connector").
8.  Click the **Import** button and select the `swagger.yaml` file you created in the previous step.
9.  Click **Continue**.
10. Review the imported settings (General, Security, Definition) and click **Create connector**.

Once the connector is saved, return to Copilot Studio. It will now be available as a tool you can enable for your copilot, allowing it to use the tools from your MCP server.
