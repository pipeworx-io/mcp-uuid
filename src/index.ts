interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * UUID validation & generation MCP.
 *
 * Keyless, offline: validate/parse a UUID (version, variant, and the embedded
 * timestamp for time-based v1/v7), and generate v4 UUIDs. Uses the platform
 * crypto — no API, no key.
 */


const RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL = '00000000-0000-0000-0000-000000000000';
const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const tools: McpToolExport['tools'] = [
  {
    name: 'validate_uuid',
    description: 'Validate and parse a UUID (keyless, offline): checks the format and returns the version (1-8), variant, whether it is nil/max, and — for time-based versions (v1, v7) — the embedded timestamp as an ISO date.',
    inputSchema: { type: 'object', properties: { uuid: { type: 'string', description: 'A UUID, e.g. "550e8400-e29b-41d4-a716-446655440000".' } }, required: ['uuid'] },
  },
  {
    name: 'generate_uuid',
    description: 'Generate one or more random v4 UUIDs.',
    inputSchema: { type: 'object', properties: { count: { type: 'number', description: 'How many to generate (1-100, default 1).' } } },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'validate_uuid': {
      const uuid = reqStr(args, 'uuid', '"550e8400-e29b-41d4-a716-446655440000"').trim();
      if (!RE.test(uuid)) return { input: uuid, valid: false, reason: 'Not a well-formed UUID (8-4-4-4-12 hex).' };
      const low = uuid.toLowerCase();
      if (low === NIL) return { input: uuid, valid: true, version: null, note: 'Nil UUID (all zeros).' };
      if (low === MAX) return { input: uuid, valid: true, version: null, note: 'Max UUID (all ones).' };
      const hex = low.replace(/-/g, '');
      const version = parseInt(hex[12], 16);
      const variantNibble = parseInt(hex[16], 16);
      const variant = variantNibble >= 8 && variantNibble <= 0xb ? 'RFC 4122' : variantNibble >= 0xc ? 'Microsoft' : 'NCS/reserved';
      const out: Record<string, unknown> = { input: uuid, valid: true, version, variant };
      if (version === 1) {
        // v1: 60-bit timestamp = time_hi(12)+time_mid(16)+time_low(32), in 100ns since 1582-10-15.
        const timeHex = hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8);
        const intervals = BigInt('0x' + timeHex);
        const ms = Number(intervals / 10000n) - 12219292800000; // Gregorian epoch offset
        out.timestamp = new Date(ms).toISOString();
      } else if (version === 7) {
        // v7: first 48 bits = Unix ms timestamp.
        const ms = Number(BigInt('0x' + hex.slice(0, 12)));
        out.timestamp = new Date(ms).toISOString();
      }
      return out;
    }
    case 'generate_uuid': {
      const count = Math.max(1, Math.min(100, typeof args.count === 'number' ? args.count : 1));
      const uuids = Array.from({ length: count }, () => crypto.randomUUID());
      return count === 1 ? { uuid: uuids[0], version: 4 } : { count, version: 4, uuids };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function reqStr(args: Record<string, unknown>, key: string, ex: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${ex}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
