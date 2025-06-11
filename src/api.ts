import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from './auth.js';

const authManager = new AuthManager();

/**
 * A helper function to make authenticated API calls to Dynamics 365.
 * It gets a token, makes the fetch call, and formats the response for MCP.
 * @param method The HTTP method (GET, POST, PATCH).
 * @param url The full URL for the API endpoint.
 * @param body The request body for POST/PATCH requests.
 * @param sendNotification The function to send notifications back to the MCP client.
 * @returns {Promise<CallToolResult>} The result of the tool call.
 */
export async function makeApiCall(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    body: Record<string, unknown> | null,
    sendNotification: (notification: any) => void
): Promise<CallToolResult> {
    try {
        await sendNotification({
            method: "notifications/message",
            params: { level: "info", data: `Calling ${method} ${url}` }
        });

        const token = await authManager.getAuthToken();

        const response = await fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/xml',
            },
            ...(body && { body: JSON.stringify(body) }),
        });

        if (response.status === 204) {
            return { content: [{ type: 'text', text: 'Operation successful (No Content).' }] };
        }

        const responseText = await response.text();

        if (!response.ok) {
            await sendNotification({
                method: "notifications/message",
                params: { level: "error", data: `API call failed with status ${response.status}: ${responseText}` }
            });
            return { isError: true, content: [{ type: 'text', text: `API Error: ${response.status}\n${responseText}` }] };
        }

        const contentType = response.headers.get("Content-Type");
        if (contentType?.includes("text/plain") || contentType?.includes("application/xml")) {
            return { content: [{ type: 'text', text: responseText }] };
        }

        try {
            const jsonResponse = JSON.parse(responseText);
            return { content: [{ type: 'text', text: JSON.stringify(jsonResponse, null, 2) }] };
        } catch {
            return { content: [{ type: 'text', text: responseText }] };
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error in makeApiCall: ${errorMessage}`);
        await sendNotification({
            method: "notifications/message",
            params: { level: "error", data: `An unexpected error occurred: ${errorMessage}` }
        });
        return { isError: true, content: [{ type: 'text', text: `An unexpected error occurred: ${errorMessage}` }] };
    }
}