import type { Graveyard } from '../core/types.js';

/**
 * Serialize a Graveyard to a deterministic JSON string.
 * Keys are alphabetically ordered at every nesting level; arrays are not reordered.
 * Invariant: toGraveyardJson(g1) === toGraveyardJson(g2) iff g1 deep-equals g2.
 */
export function toGraveyardJson(graveyard: Graveyard): string {
  return JSON.stringify(sortedKeys(graveyard as unknown as JsonValue), null, 2);
}

/**
 * Parse a graveyard JSON string back to a Graveyard object.
 */
export function fromGraveyardJson(json: string): Graveyard {
  return JSON.parse(json) as Graveyard;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

function sortedKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return (value as JsonArray).map(sortedKeys);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as JsonObject;
    const sorted: JsonObject = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortedKeys(obj[key] as JsonValue);
    }
    return sorted;
  }
  return value;
}
