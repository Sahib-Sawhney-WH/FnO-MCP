import { AuthManager } from './auth.js';
import * as stringSimilarity from 'string-similarity';

// You can adjust this threshold. A lower value is more lenient.
const SIMILARITY_THRESHOLD = 0.4;

interface ODataEntity {
    name: string;
    url: string;
}

/**
 * Manages the list of OData entities, including fetching, caching, and matching.
 */
export class EntityManager {
    private entityCache: ODataEntity[] | null = null;
    private authManager = new AuthManager();

    /**
     * Finds the best matching OData entity name for a given user query.
     * @param query The user's (potentially inexact) entity name.
     * @returns The corrected, official entity name or null if no good match is found.
     */
    public async findBestMatch(query: string): Promise<string | null> {
        if (!this.entityCache) {
            this.entityCache = await this.fetchEntities();
        }

        const entityNames = this.entityCache.map(e => e.name);
        const bestMatch = stringSimilarity.findBestMatch(query, entityNames);

        if (bestMatch.bestMatch.rating > SIMILARITY_THRESHOLD) {
            const matchedEntity = this.entityCache.find(e => e.name === bestMatch.bestMatch.target);
            // The 'url' field from the service document is the correct name to use in API calls
            return matchedEntity ? matchedEntity.url : null;
        }

        return null;
    }

    /**
     * Fetches the list of all OData entities from the /data endpoint.
     */
    private async fetchEntities(): Promise<ODataEntity[]> {
        console.log('Fetching OData entity list for the first time...');
        const token = await this.authManager.getAuthToken();
        const url = `${process.env.DYNAMICS_RESOURCE_URL}/data`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch entity list: ${response.statusText}`);
            }

            const data = await response.json();
            // The payload contains a 'value' array with objects having 'name' and 'url'
            return data.value.map((entity: { name: string, url: string }) => ({
                name: entity.name,
                url: entity.url
            }));
        } catch (error) {
            console.error("Error fetching entity list:", error);
            // Return an empty array on failure to prevent repeated attempts
            return [];
        }
    }
}