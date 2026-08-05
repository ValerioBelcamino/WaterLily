export const GRAPH_DOCUMENT_SCHEMA = {
  $id: 'https://waterlily.dev/schemas/graph-document-v1.json',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  additionalProperties: false,
  properties: {
    exportedAt: { format: 'date-time', type: 'string' },
    exporter: {
      additionalProperties: false,
      properties: {
        name: { minLength: 1, type: 'string' },
        version: { minLength: 1, type: 'string' },
      },
      required: ['name', 'version'],
      type: 'object',
    },
    format: { const: 'waterlily/graph' },
    graph: { type: 'object' },
    schemaVersion: { const: 1 },
    view: {
      additionalProperties: false,
      properties: {
        groups: { type: 'array' },
        positions: { type: 'object' },
      },
      required: ['groups', 'positions'],
      type: 'object',
    },
  },
  required: [
    'exportedAt',
    'exporter',
    'format',
    'graph',
    'schemaVersion',
    'view',
  ],
  title: 'WaterLily graph document',
  type: 'object',
} as const;
