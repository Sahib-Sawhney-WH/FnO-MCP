import { AuthManager } from './auth.js';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { AuthManager } from './auth.js';

// Mock the global fetch function
global.fetch = jest.fn();

describe('AuthManager', () => {
    let authManager: AuthManager;

    beforeEach(() => {
        authManager = new AuthManager();
        // Clear mocks and reset environment variables before each test
        (global.fetch as jest.Mock).mockClear();
        process.env.TENANT_ID = 'test-tenant';
        process.env.CLIENT_ID = 'test-client';
        process.env.CLIENT_SECRET = 'test-secret';
        process.env.DYNAMICS_RESOURCE_URL = 'https://test.dynamics.com';
    });

    it('should fetch a new token if cache is empty', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                access_token: 'new-token-123',
                expires_in: '3600'
            }),
        });

        const token = await authManager.getAuthToken();
        expect(token).toBe('new-token-123');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should use a cached token if it is still valid', async () => {
        // First call to populate cache
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                access_token: 'cached-token-456',
                expires_in: '3600'
            }),
        });
        await authManager.getAuthToken();

        // Second call should use the cache
        const token = await authManager.getAuthToken();
        expect(token).toBe('cached-token-456');
        // Fetch should still have only been called once
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should fetch a new token if the cached token is expired', async () => {
        // Manually set an expired token in the cache
        (authManager as any).tokenCache = {
            accessToken: 'expired-token',
            expiresAt: Date.now() - 1000, // Expired 1 second ago
        };

        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                access_token: 'refreshed-token-789',
                expires_in: '3600'
            }),
        });

        const token = await authManager.getAuthToken();
        expect(token).toBe('refreshed-token-789');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw an error if the token fetch fails', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve('Unauthorized'),
        });

        await expect(authManager.getAuthToken()).rejects.toThrow('Failed to fetch auth token: 401 Unauthorized');
    });
});