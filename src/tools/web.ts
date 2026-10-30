import { loadConfig } from "../config/index";
import type { ToolResult } from "./index";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 15000;
const MAX_FETCH_BYTES = 1_000_000;
const MAX_RESULTS = 6;

type SearchResult = { title: string; url: string; snippet: string };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/pre|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return (title ? `# ${stripTags(title)}\n\n` : "") + text;
}

function unwrapDuckDuckGoUrl(href: string): string {
  const full = href.startsWith("//") ? "https:" + href : href;
  try {
    const url = new URL(full);
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : full;
  } catch {
    return full;
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query, kl: "wt-wt" }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DuckDuckGo returned HTTP ${res.status}`);
  const html = await res.text();

  const results: SearchResult[] = [];
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    const link = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "";
    results.push({
      title: stripTags(link[2]),
      url: unwrapDuckDuckGoUrl(decodeEntities(link[1])),
      snippet: stripTags(snippet).slice(0, 300),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  if (results.length === 0) {
    throw new Error("DuckDuckGo returned no results (it may be rate-limiting; try again shortly)");
  }
  return results;
}

async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: MAX_RESULTS }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily returned HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.results ?? []).map((r: any) => ({
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    snippet: String(r.content ?? "").slice(0, 400),
  }));
}

export async function webSearch(query: string): Promise<ToolResult> {
  const q = String(query ?? "").trim();
  if (!q || q.length > 500) {
    return { ok: false, error: "Query must be a non-empty string (max 500 characters)." };
  }

  const config = await loadConfig();
  const tavilyKey = config?.keys?.tavily || process.env.TAVILY_API_KEY;

  try {
    const results = tavilyKey ? await searchTavily(q, tavilyKey) : await searchDuckDuckGo(q);
    if (results.length === 0) return { ok: true, output: "No results found." };
    return {
      ok: true,
      output: results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n"),
    };
  } catch (err: any) {
    return { ok: false, error: `Web search failed: ${err?.message ?? err}` };
  }
}

export async function fetchURL(rawUrl: string): Promise<ToolResult> {
  let url: URL;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, error: `Invalid URL: ${rawUrl}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs can be fetched." };
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= MAX_FETCH_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const raw = Buffer.concat(chunks).toString("utf-8");
    const type = res.headers.get("content-type") ?? "";

    let body = raw;
    if (type.includes("html")) body = htmlToText(raw);
    else if (type.includes("json")) {
      try {
        body = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {}
    }

    const header = `${res.status} ${res.statusText} · ${type || "unknown type"} · ${res.url}`;
    return res.ok
      ? { ok: true, output: `${header}\n\n${body}` }
      : { ok: false, error: `${header}\n\n${body.slice(0, 500)}` };
  } catch (err: any) {
    return { ok: false, error: `Fetch failed: ${err?.name === "TimeoutError" ? "timed out" : (err?.message ?? err)}` };
  }
}
