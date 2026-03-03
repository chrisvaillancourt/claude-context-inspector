/**
 * Transparent proxy that captures the system prompt from Claude Code API requests.
 *
 * Usage:
 *   bun run capture-proxy.ts
 *   # Then in another terminal:
 *   ANTHROPIC_BASE_URL=http://localhost:9876 claude
 *
 * The proxy intercepts POST /v1/messages, extracts the `system` field
 * (which contains the full system prompt, CLAUDE.md, hooks, etc.),
 * saves it to a timestamped JSON file, and forwards the request to
 * the real Anthropic API with streaming passthrough.
 */

const ANTHROPIC_API = "https://api.anthropic.com";
const PORT = parseInt(process.env.PORT || "9876");
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./captures";

await Bun.write(`${OUTPUT_DIR}/.gitkeep`, "");

let captureCount = 0;
let savedHashes = new Set<string>();

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const targetUrl = `${ANTHROPIC_API}${url.pathname}${url.search}`;

    // For non-messages endpoints, just proxy through
    if (req.method !== "POST" || !url.pathname.endsWith("/messages")) {
      const resp = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders(req.headers),
        body: req.body,
      });
      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    }

    // POST /v1/messages — capture the system prompt
    const bodyText = await req.text();
    let parsed: any;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // Can't parse, just forward
      return forwardRaw(targetUrl, req, bodyText);
    }

    // Extract and save the system field (deduplicate identical prompts from retries)
    if (parsed.system) {
      const systemJson = JSON.stringify(parsed.system);
      const hasher = new Bun.CryptoHasher("md5");
      hasher.update(systemJson);
      const hash = hasher.digest("hex");

      if (!savedHashes.has(hash)) {
        savedHashes.add(hash);
        captureCount++;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `${OUTPUT_DIR}/context-${ts}.json`;

        const capture = {
          captured_at: new Date().toISOString(),
          session_number: captureCount,
          model: parsed.model,
          system_blocks: parsed.system,
          message_count: parsed.messages?.length ?? 0,
          first_user_message: extractFirstUserMessage(parsed.messages),
          metadata: {
            stream: parsed.stream ?? false,
            max_tokens: parsed.max_tokens,
            tools_count: parsed.tools?.length ?? 0,
            tool_names: (parsed.tools ?? []).map(
              (t: any) => t.name || t.function?.name || "unknown"
            ),
          },
        };

        await Bun.write(filename, JSON.stringify(capture, null, 2));

        const blockCount = Array.isArray(parsed.system)
          ? parsed.system.length
          : 1;
        console.log(
          `[capture #${captureCount}] Saved ${blockCount} system block(s) (${(systemJson.length / 1024).toFixed(1)}KB) → ${filename}`
        );
      } else {
        console.log(`[skip] Duplicate system prompt (retry), not saving`);
      }
    }

    // Forward the original request to Anthropic
    return forwardRaw(targetUrl, req, bodyText);
  },
});

function forwardHeaders(headers: Headers): HeadersInit {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    // Skip host (let fetch set it) and accept-encoding (avoid compression
    // mismatch — the client expects to decompress but our proxy passes
    // through raw bytes, causing ZlibError)
    if (lower !== "host" && lower !== "accept-encoding") {
      out[k] = v;
    }
  });
  return out;
}

async function forwardRaw(
  targetUrl: string,
  req: Request,
  body: string
): Promise<Response> {
  const resp = await fetch(targetUrl, {
    method: req.method,
    headers: forwardHeaders(req.headers),
    body,
  });
  // Bun's fetch auto-decompresses response bodies, so we must strip
  // content-encoding and content-length from the response to avoid the
  // client trying to decompress already-decompressed data.
  const respHeaders = new Headers(resp.headers);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}

function extractFirstUserMessage(messages: any[]): string | null {
  if (!Array.isArray(messages)) return null;
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") return msg.content.slice(0, 200);
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            return block.text.slice(0, 200);
          }
        }
      }
    }
  }
  return null;
}

console.log(`Context inspector proxy listening on http://localhost:${PORT}`);
console.log(`Captures will be saved to ${OUTPUT_DIR}/`);
console.log(`\nTo use: ANTHROPIC_BASE_URL=http://localhost:${PORT} claude\n`);
