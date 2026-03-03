/**
 * Renders captured context JSON files as readable HTML.
 *
 * Usage:
 *   bun run view.ts [capture-file.json]
 *
 * If no file specified, uses the most recent capture in ./captures/
 * Opens the rendered HTML in the default browser.
 */

import { readdirSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = process.env.OUTPUT_DIR || "./captures";

// Find the capture file to render
let captureFile = process.argv[2];
if (!captureFile) {
  const files = readdirSync(OUTPUT_DIR)
    .filter((f) => f.startsWith("context-") && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) {
    console.error(
      "No captures found. Run the proxy first to capture a session."
    );
    process.exit(1);
  }
  captureFile = join(OUTPUT_DIR, files[0]);
  console.log(`Using most recent capture: ${captureFile}`);
}

const data = await Bun.file(captureFile).json();
const html = renderHtml(data);

const outputPath = captureFile.replace(".json", ".html");
await Bun.write(outputPath, html);
console.log(`Rendered → ${outputPath}`);

// Open in browser
Bun.spawn(["open", outputPath]);

function renderHtml(capture: any): string {
  const blocks = Array.isArray(capture.system_blocks)
    ? capture.system_blocks
    : [{ type: "text", text: String(capture.system_blocks) }];

  const injected = (capture.injected_context ?? []) as {
    source: string;
    content: string;
  }[];

  const totalSystemChars = blocks.reduce(
    (sum: number, b: any) => sum + (b.text?.length ?? 0),
    0
  );
  const totalInjectedChars = injected.reduce(
    (sum: number, b: any) => sum + (b.content?.length ?? 0),
    0
  );
  const totalChars = totalSystemChars + totalInjectedChars;

  let blockIndex = 0;

  const systemBlocksHtml = blocks
    .map((block: any) => {
      blockIndex++;
      const text = block.text ?? JSON.stringify(block, null, 2);
      const source = identifySource(text);
      const chars = text.length;
      const cacheType = block.cache_control?.type ?? "none";

      return `
      <details class="block" ${blockIndex === 1 ? "open" : ""}>
        <summary>
          <span class="block-num">#${blockIndex}</span>
          <span class="source-tag ${source.className}">${source.label}</span>
          <span class="chars">${(chars / 1024).toFixed(1)}KB · ${chars.toLocaleString()} chars</span>
          ${cacheType !== "none" ? `<span class="cache-tag">cache: ${cacheType}</span>` : ""}
        </summary>
        <pre><code>${escapeHtml(text)}</code></pre>
      </details>`;
    })
    .join("\n");

  const injectedBlocksHtml = injected
    .map((block: any) => {
      blockIndex++;
      const sourceTag = sourceTagForReminder(block.source);
      const chars = block.content.length;

      return `
      <details class="block">
        <summary>
          <span class="block-num">#${blockIndex}</span>
          <span class="source-tag ${sourceTag.className}">${sourceTag.label}</span>
          <span class="chars">${(chars / 1024).toFixed(1)}KB · ${chars.toLocaleString()} chars</span>
          <span class="cache-tag">injected via message</span>
        </summary>
        <pre><code>${escapeHtml(block.content)}</code></pre>
      </details>`;
    })
    .join("\n");

  const injectedHeader =
    injected.length > 0
      ? `<h2 class="section-header">Injected Context <span class="dim">(via &lt;system-reminder&gt; in messages)</span></h2>`
      : "";

  const blocksHtml =
    `<h2 class="section-header">System Prompt <span class="dim">(API system field)</span></h2>` +
    systemBlocksHtml +
    injectedHeader +
    injectedBlocksHtml;

  const toolNames = (capture.metadata?.tool_names ?? []) as string[];
  const toolsSummary =
    toolNames.length > 0
      ? `<details class="tools-section">
        <summary>Tools (${toolNames.length})</summary>
        <div class="tools-grid">${toolNames.map((t: string) => `<span class="tool-name">${escapeHtml(t)}</span>`).join("")}</div>
      </details>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Context Inspector</title>
  <style>
    :root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #e6edf3; --dim: #8b949e; --accent: #58a6ff; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); padding: 24px; line-height: 1.6; }
    h1 { font-size: 1.4em; margin-bottom: 4px; }
    .meta { color: var(--dim); font-size: 0.85em; margin-bottom: 24px; }
    .meta span { margin-right: 16px; }
    .stats { display: flex; gap: 24px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; min-width: 120px; }
    .stat-value { font-size: 1.6em; font-weight: 600; color: var(--accent); }
    .stat-label { font-size: 0.8em; color: var(--dim); }
    details.block { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; }
    details.block summary { padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 0.9em; }
    details.block summary:hover { background: #1c2128; }
    .block-num { color: var(--dim); font-family: monospace; min-width: 28px; }
    .source-tag { padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 600; text-transform: uppercase; }
    .source-tag.system-prompt { background: #1f3a5f; color: #79c0ff; }
    .source-tag.claude-md { background: #2a1f3f; color: #d2a8ff; }
    .source-tag.hook-output { background: #1f3f2a; color: #7ee787; }
    .source-tag.mcp-config { background: #3f2a1f; color: #ffa657; }
    .source-tag.skill-list { background: #3f3f1f; color: #e3b341; }
    .source-tag.unknown { background: #2d2d2d; color: #8b949e; }
    .chars { color: var(--dim); font-size: 0.8em; margin-left: auto; }
    .cache-tag { font-size: 0.7em; padding: 1px 6px; border-radius: 3px; background: #1a3a2a; color: #3fb950; }
    details.block pre { margin: 0; padding: 16px; overflow-x: auto; border-top: 1px solid var(--border); max-height: 600px; overflow-y: auto; }
    details.block code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.82em; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .tools-section { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 24px; }
    .tools-section summary { padding: 12px 16px; cursor: pointer; font-size: 0.9em; }
    .tools-grid { padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 4px; border-top: 1px solid var(--border); }
    .tool-name { font-family: monospace; font-size: 0.75em; padding: 2px 6px; background: #1c2128; border: 1px solid var(--border); border-radius: 3px; }
    #search { width: 100%; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.9em; margin-bottom: 16px; }
    #search:focus { outline: none; border-color: var(--accent); }
    .hidden { display: none !important; }
    .section-header { font-size: 1em; margin: 20px 0 8px; color: var(--dim); font-weight: 500; }
    .section-header .dim { font-size: 0.8em; font-weight: 400; }
  </style>
</head>
<body>
  <h1>Claude Context Inspector</h1>
  <div class="meta">
    <span>Captured: ${capture.captured_at}</span>
    <span>Model: ${capture.model ?? "unknown"}</span>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-value">${blocks.length + injected.length}</div><div class="stat-label">Context Blocks</div></div>
    <div class="stat"><div class="stat-value">${(totalChars / 1024).toFixed(1)}KB</div><div class="stat-label">Total Context</div></div>
    <div class="stat"><div class="stat-value">${capture.metadata?.tools_count ?? 0}</div><div class="stat-label">Tools</div></div>
    <div class="stat"><div class="stat-value">${capture.message_count ?? 0}</div><div class="stat-label">Messages</div></div>
  </div>
  ${toolsSummary}
  <input type="text" id="search" placeholder="Search context blocks..." />
  <div id="blocks">
    ${blocksHtml}
  </div>
  <script>
    document.getElementById('search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.block').forEach(block => {
        const text = block.textContent.toLowerCase();
        block.classList.toggle('hidden', q && !text.includes(q));
      });
    });
  </script>
</body>
</html>`;
}

function sourceTagForReminder(
  source: string
): { label: string; className: string } {
  const map: Record<string, { label: string; className: string }> = {
    "hook:SessionStart": { label: "Hook", className: "hook-output" },
    "claude-md": { label: "CLAUDE.md", className: "claude-md" },
    skills: { label: "Skills", className: "skill-list" },
    "mcp-instructions": { label: "MCP Config", className: "mcp-config" },
    "git-status": { label: "Git Status", className: "hook-output" },
    "current-date": { label: "Metadata", className: "unknown" },
    "fast-mode": { label: "Metadata", className: "unknown" },
  };
  return map[source] ?? { label: source, className: "unknown" };
}

function identifySource(text: string): { label: string; className: string } {
  if (
    text.includes("You are Claude Code") ||
    text.includes("you have access to a set of tools")
  )
    return { label: "System Prompt", className: "system-prompt" };
  if (text.includes("claudeMd") || text.includes("CLAUDE.md"))
    return { label: "CLAUDE.md", className: "claude-md" };
  if (
    text.includes("SessionStart") ||
    text.includes("hook") ||
    text.includes("Hook")
  )
    return { label: "Hook Output", className: "hook-output" };
  if (text.includes("MCP") || text.includes("mcp_server"))
    return { label: "MCP Config", className: "mcp-config" };
  if (
    text.includes("skills are available") ||
    text.includes("Skill tool")
  )
    return { label: "Skills", className: "skill-list" };
  if (text.includes("gitStatus") || text.includes("git status"))
    return { label: "Git Status", className: "hook-output" };
  return { label: "Context", className: "unknown" };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
