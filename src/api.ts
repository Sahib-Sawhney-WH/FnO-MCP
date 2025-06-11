import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from './auth.js';

const authManager = new AuthManager();

// Helper function to safely send notifications
async function safeNotify(sendNotification: (notification: any) => void | Promise<void>, notification: any): Promise<void> {
    try {
        await sendNotification(notification);
    } catch (error) {
        // Silently ignore notification errors (e.g., in test environments)
        // This is expected in test environments where notifications aren't supported
    }
}

export async function makeApiCall(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    body: Record<string, unknown> | null,
    sendNotification: (notification: any) => void | Promise<void>
): Promise<CallToolResult> {
    try {
        await safeNotify(sendNotification, {
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
            await safeNotify(sendNotification, {
                method: "notifications/message",
                params: { level: "error", data: `API call failed with status ${response.status}: ${responseText}` }
            });

            // Try to parse the error as JSON for a more structured response
            try {
                const errorJson = JSON.parse(responseText);
                const prettyError = JSON.stringify(errorJson, null, 2);
                return { isError: true, content: [{ type: 'text', text: `API Error: ${response.status}\n${prettyError}` }] };
            } catch (e) {
                // If parsing fails, fall back to the original text response
                return { isError: true, content: [{ type: 'text', text: `API Error: ${response.status}\n${responseText}` }] };
            }
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
        await safeNotify(sendNotification, {
            method: "notifications/message",
            params: { level: "error", data: `An unexpected error occurred: ${errorMessage}` }
        });
        return { isError: true, content: [{ type: 'text', text: `An unexpected error occurred: ${errorMessage}` }] };
    }
}