// src/entityManager.ts

import { AuthManager } from './auth.js';
import Fuse from 'fuse.js';
import { XMLParser } from 'fast-xml-parser';

// Threshold for fuzzy matching (0 = exact match, 1 = match anything)
const FUZZY_THRESHOLD = 0.6;

interface ODataEntity {
    name: string;
    url: string;
}

interface EntitySchema {
    name: string;
    fields: {
        name: string;
        type: string;
        isKey: boolean;
    }[];
}


/**
 * Manages the list of OData entities, including fetching, caching, and matching.
 */
export class EntityManager {
    private entityCache: ODataEntity[] | null = null;
    private schemaCache: Record<string, EntitySchema> | null = null;
    private authManager = new AuthManager();
    private fuse: Fuse<ODataEntity> | null = null;

    /**
     * Finds the best matching OData entity name for a given user query.
     * @param query The user's (potentially inexact) entity name.
     * @returns The corrected, official entity name or null if no good match is found.
     */
    public async findBestMatch(query: string): Promise<string | null> {
        if (!this.entityCache) {
            this.entityCache = await this.fetchEntityList(); 
            this.fuse = new Fuse(this.entityCache, {
                keys: ['name', 'url'],
                threshold: FUZZY_THRESHOLD,
                includeScore: true
            });
        }

        if (!this.fuse || this.entityCache.length === 0) {
            return null;
        }

        const results = this.fuse.search(query);
        if (results.length > 0 && results[0].score !== undefined && results[0].score <= FUZZY_THRESHOLD) {
            return results[0].item.url;
        }

        return null;
    }

    /**
     * Retrieves the parsed schema for a specific entity.
     * @param entityName The official name of the entity (e.g., 'PurchaseOrderHeadersV2').
     * @returns The parsed schema object, or null if not found.
     */
    public async getEntitySchema(entityName: string): Promise<EntitySchema | null> {
        if (!this.schemaCache) {
            console.log('Schema cache is empty. Fetching and parsing $metadata for the first time...');
            this.schemaCache = await this.fetchAndParseMetadata();
        }
        
        const schema = this.schemaCache?.[entityName];
        if (schema) return schema;

        if (entityName.endsWith('s')) {
            const singularName = entityName.slice(0, -1);
            return this.schemaCache?.[singularName] || null;
        }

        return null;
    }

    /**
     * Fetches the list of all OData entities from the /data endpoint.
     */
    private async fetchEntityList(): Promise<ODataEntity[]> {
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
            return data.value.map((entity: { name: string, url: string }) => ({
                name: entity.name,
                url: entity.url
            }));
        } catch (error) {
            console.error("Error fetching entity list:", error);
            return [];
        }
    }
    
    /**
     * Fetches the full OData $metadata, parses it, and caches it.
     * @returns A record of entity schemas, keyed by entity name.
     */
    private async fetchAndParseMetadata(): Promise<Record<string, EntitySchema>> {
        const token = await this.authManager.getAuthToken();
        const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/$metadata`;
        console.log(`Fetching full metadata from ${url}`);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch $metadata: ${response.statusText}`);
            }

            const xmlData = await response.text();
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_"
            });
            const jsonObj = parser.parse(xmlData);

            const finalSchemaMap: Record<string, EntitySchema> = {};
            const dataServices = jsonObj['edmx:Edmx']?.['edmx:DataServices'];
            
            if (!dataServices || !dataServices.Schema) {
                console.error("Could not find 'DataServices.Schema' in the parsed metadata object.");
                return {};
            }

            const schemas = Array.isArray(dataServices.Schema) ? dataServices.Schema : [dataServices.Schema];

            for (const schema of schemas) {
                if (!schema.EntityType) continue; 

                const entityTypes = Array.isArray(schema.EntityType) ? schema.EntityType : [schema.EntityType];

                for (const entity of entityTypes) {
                    const entityName = entity['@_Name'];
                    const fields: { name: string; type: string; isKey: boolean; }[] = [];
                    
                    // --- MODIFIED: Handle cases where there is only one Primary Key field ---
                    const rawPropertyRefs = entity.Key?.PropertyRef;
                    const keys = rawPropertyRefs 
                        ? (Array.isArray(rawPropertyRefs) ? rawPropertyRefs : [rawPropertyRefs]).map((pr: any) => pr['@_Name']) 
                        : [];
                    
                    const properties = entity.Property ? (Array.isArray(entity.Property) ? entity.Property : [entity.Property]) : [];

                    for (const prop of properties) {
                        fields.push({
                            name: prop['@_Name'],
                            type: prop['@_Type'],
                            isKey: keys.includes(prop['@_Name'])
                        });
                    }
                    finalSchemaMap[entityName] = { name: entityName, fields };
                }
            }

            console.log(`Successfully parsed metadata. Available schema keys:`, Object.keys(finalSchemaMap).length);
            return finalSchemaMap;

        } catch (error) {
            console.error("Error fetching or parsing $metadata:", error);
            return {};
        }
    }
}