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
    // MODIFIED: Caches schemas by their full type name, e.g., 'Microsoft.Dynamics.DataEntities.PurchaseOrderHeaderV2'
    private schemaCache: Record<string, EntitySchema> | null = null;
    // NEW: A map to link the entity set name to its type name.
    private entitySetToTypeMap: Record<string, string> | null = null;
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
     * @param entitySetName The public name of the entity set (e.g., 'PurchaseOrderHeadersV2').
     * @returns The parsed schema object, or null if not found.
     */
    public async getEntitySchema(entitySetName: string): Promise<EntitySchema | null> {
        // If caches are empty, populate them by parsing the metadata.
        if (!this.schemaCache || !this.entitySetToTypeMap) {
            console.log('Caches are empty. Fetching and parsing $metadata for the first time...');
            const { schemaCache, entitySetToTypeMap } = await this.fetchAndParseMetadata();
            this.schemaCache = schemaCache;
            this.entitySetToTypeMap = entitySetToTypeMap;
        }
        
        if (!this.entitySetToTypeMap || !this.schemaCache) {
            return null;
        }
        
        // Step 1: Use the map to find the full entity type name.
        const entityTypeName = this.entitySetToTypeMap[entitySetName];
        if (!entityTypeName) {
            console.error(`Could not find a type mapping for entity set '${entitySetName}'.`);
            return null;
        }

        // Step 2: Use the full type name to get the schema from the cache.
        return this.schemaCache[entityTypeName] || null;
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
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
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
     * Fetches the full OData $metadata, parses it, and builds caches.
     * @returns An object containing the schema cache and the entity set map.
     */
    private async fetchAndParseMetadata(): Promise<{ schemaCache: Record<string, EntitySchema>, entitySetToTypeMap: Record<string, string> }> {
        const token = await this.authManager.getAuthToken();
        const url = `${process.env.DYNAMICS_RESOURCE_URL}/data/$metadata`;
        console.log(`Fetching full metadata from ${url}`);

        const emptyResult = { schemaCache: {}, entitySetToTypeMap: {} };

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

            const schemaCache: Record<string, EntitySchema> = {};
            const entitySetToTypeMap: Record<string, string> = {};
            const dataServices = jsonObj['edmx:Edmx']?.['edmx:DataServices'];
            
            if (!dataServices || !dataServices.Schema) {
                console.error("Could not find 'DataServices.Schema' in the parsed metadata object.");
                return emptyResult;
            }

            const schemas = Array.isArray(dataServices.Schema) ? dataServices.Schema : [dataServices.Schema];

            for (const schema of schemas) {
                const schemaNamespace = schema['@_Namespace'];

                // --- Process Entity Types ---
                if (schema.EntityType) {
                    const entityTypes = Array.isArray(schema.EntityType) ? schema.EntityType : [schema.EntityType];
                    for (const entity of entityTypes) {
                        const entityName = entity['@_Name'];
                        const fullTypeName = `${schemaNamespace}.${entityName}`;
                        const fields: { name: string; type: string; isKey: boolean; }[] = [];
                        
                        const rawPropertyRefs = entity.Key?.PropertyRef;
                        const keys = rawPropertyRefs ? (Array.isArray(rawPropertyRefs) ? rawPropertyRefs : [rawPropertyRefs]).map((pr: any) => pr['@_Name']) : [];
                        const properties = entity.Property ? (Array.isArray(entity.Property) ? entity.Property : [entity.Property]) : [];

                        for (const prop of properties) {
                            fields.push({
                                name: prop['@_Name'],
                                type: prop['@_Type'],
                                isKey: keys.includes(prop['@_Name'])
                            });
                        }
                        schemaCache[fullTypeName] = { name: entityName, fields };
                    }
                }
                
                // --- Process the Entity Container to build the map ---
                if (schema.EntityContainer) {
                    const entitySets = Array.isArray(schema.EntityContainer.EntitySet) ? schema.EntityContainer.EntitySet : [schema.EntityContainer.EntitySet];
                    for (const entitySet of entitySets) {
                        const setName = entitySet['@_Name'];
                        const typeName = entitySet['@_EntityType'];
                        entitySetToTypeMap[setName] = typeName;
                    }
                }
            }

            console.log(`Successfully parsed metadata. Found ${Object.keys(schemaCache).length} schema types and ${Object.keys(entitySetToTypeMap).length} entity sets.`);
            return { schemaCache, entitySetToTypeMap };

        } catch (error) {
            console.error("Error fetching or parsing $metadata:", error);
            return emptyResult;
        }
    }
}