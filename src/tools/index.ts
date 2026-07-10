import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import fsSync from "fs";

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "dist",
  "build",
  ".next",
  ".turbo",
]);

const BLOCKED_COMMANDS = new Set([
  "rm -rf /",
  "del /s /q",
  "format",
  "dd if=/dev/zero",
  ":(){:|:&};:",
]);

function validateFilePath(filePath: string): {
  valid: boolean;
  error?: string;
} {
  if (!filePath || typeof filePath !== "string") {
    return { valid: false, error: "Invalid file path" };
  }
  const resolved = path.resolve(filePath);
  const cwd = path.resolve(process.cwd());
  const relative = path.relative(cwd, resolved);
  const isInsideProject =
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  const tmpRoot = path.resolve("/tmp");
  const tmpRelative = path.relative(tmpRoot, resolved);
  const isTmpPath =
    process.platform !== "win32" &&
    (tmpRelative === "" ||
      (!tmpRelative.startsWith("..") && !path.isAbsolute(tmpRelative)));

  if (!isInsideProject && !isTmpPath) {
    return { valid: false, error: "File path must be within project or /tmp" };
  }
  return { valid: true };
}

const trimLine = (l: string) => l.trim();
const collapseWs = (l: string) => l.replace(/\s+/g, " ").trim();

function findNormalizedMatch(
  current: string,
  oldContent: string,
  normalizeLine: (l: string) => string,
): string | null {
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const fileLines = current.split(/\r?\n/);
  const oldLines = oldContent.split(/\r?\n/).map(normalizeLine);

  for (let i = 0; i <= fileLines.length - oldLines.length; i++) {
    let match = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (normalizeLine(fileLines[i + j]) !== oldLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return fileLines.slice(i, i + oldLines.length).join(eol);
    }
  }
  return null;
}

function closestRegion(
  current: string,
  oldContent: string,
): { line: number; text: string } | null {
  const fileLines = current.split(/\r?\n/);
  const oldLines = oldContent.split(/\r?\n/).map(collapseWs);
  const size = Math.min(oldLines.length, fileLines.length);
  if (size === 0) return null;

  let bestHits = 0;
  let bestIndex = -1;
  for (let i = 0; i <= fileLines.length - size; i++) {
    let hits = 0;
    for (let j = 0; j < size; j++) {
      if (collapseWs(fileLines[i + j]) === oldLines[j]) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;

  const text = fileLines.slice(bestIndex, bestIndex + Math.min(size, 10)).join("\n");
  return { line: bestIndex + 1, text: text.slice(0, 600) };
}

function resolveEditMatch(
  current: string,
  oldContent: string,
  newContent: string,
): { old: string; next: string } {
  // Whatever path matches, the inserted text always uses the file's own
  // line-ending style — otherwise edits create mixed CRLF/LF files.
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const next = newContent.replace(/\r?\n/g, eol);

  if (current.includes(oldContent)) {
    return { old: oldContent, next };
  }

  const crlf = oldContent.replace(/\r?\n/g, "\r\n");
  if (current.includes(crlf)) {
    return { old: crlf, next };
  }
  const lf = oldContent.replace(/\r\n/g, "\n");
  if (current.includes(lf)) {
    return { old: lf, next };
  }

  // Tier 4: ignore leading/trailing whitespace per line.
  // Tier 5: also collapse internal whitespace runs ("Hello  World").
  const found =
    findNormalizedMatch(current, oldContent, trimLine) ??
    findNormalizedMatch(current, oldContent, collapseWs);
  if (found) {
    return { old: found, next };
  }

  return { old: oldContent, next };
}

function validateCommand(command: string): { valid: boolean; error?: string } {
  if (!command || typeof command !== "string") {
    return { valid: false, error: "Invalid command" };
  }
  const normalized = command.toLowerCase();
  for (const blocked of BLOCKED_COMMANDS) {
    if (normalized.includes(blocked.toLowerCase())) {
      return { valid: false, error: `Blocked command: ${blocked}` };
    }
  }
  return { valid: true };
}

class Tools {
  async runCommand({ command }: { command: string }): Promise<string> {
    const validation = validateCommand(command);
    if (!validation.valid) {
      return JSON.stringify({
        success: false,
        error: validation.error,
      });
    }

    const TIMEOUT_MS = 120_000;

    return new Promise((resolve) => {
      const child = spawn(command, {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "",
        errorOutput = "";
      let settled = false;

      const finish = (payload: object) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(JSON.stringify(payload));
      };

      const timer = setTimeout(() => {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          child.kill("SIGKILL");
        }
        finish({
          success: false,
          error: `Command timed out after ${TIMEOUT_MS / 1000}s and was killed. If it is a server or watcher use startBackground; if it prompts for input, pass non-interactive flags. Output so far: ${(output + errorOutput).slice(-500)}`,
        });
      }, TIMEOUT_MS);

      child.stdout.on("data", (d) => (output += d.toString()));
      child.stderr.on("data", (d) => (errorOutput += d.toString()));
      child.on("close", (code) => {
        finish(
          code === 0
            ? {
                success: true,
                data: output || "Command executed successfully",
              }
            : { success: false, error: errorOutput || output },
        );
      });
      child.on("error", (err) =>
        finish({ success: false, error: err.message }),
      );
    });
  }

  async createFile({
    filePath,
    content,
  }: {
    filePath: string;
    content: string;
  }): Promise<string> {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      return JSON.stringify({
        success: true,
        data: `File ${filePath} created successfully.`,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  async readFile({
    filePath,
    offset = 1,
    limit = 200,
  }: {
    filePath: string;
    offset?: number;
    limit?: number;
  }): Promise<string> {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }

    // Validate offset and limit
    if (offset < 1) {
      return JSON.stringify({
        success: false,
        error: "Offset must be >= 1",
      });
    }
    if (limit < 1 || limit > 500) {
      return JSON.stringify({
        success: false,
        error: "Limit must be between 1 and 500",
      });
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      // Split on \r?\n so CRLF files don't leak invisible \r into the
      // numbered lines the model copies back into editFile.
      const lines = content.split(/\r?\n/);
      const total = lines.length;
      const start = Math.max(0, offset - 1);
      const end = Math.min(start + limit, total);

      const numbered = lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}| ${line}`)
        .join("\n");

      const hint =
        end < total
          ? `\n\n(Showing lines ${offset}-${end} of ${total}. Use offset=${end + 1} to continue.)`
          : `\n\n(End of file — ${total} lines total)`;

      return JSON.stringify({ success: true, data: numbered + hint });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  async listDirectory({ dirPath }: { dirPath: string }): Promise<string> {
    const validation = validateFilePath(dirPath);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }

    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      const filtered = files
        .filter((e) => !IGNORE_DIRS.has(e.name))
        .map((e) => (e.isDirectory() ? `📁 ${e.name}` : `📄 ${e.name}`));
      return JSON.stringify({ success: true, data: filtered });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  async editFile({
    filePath,
    oldContent,
    newContent,
    startLine,
    endLine,
  }: {
    filePath: string;
    oldContent?: string;
    newContent: string;
    startLine?: number;
    endLine?: number;
  }): Promise<string> {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }

    if (typeof newContent !== "string") {
      return JSON.stringify({
        success: false,
        error: 'newContent must be a string (use "" to delete the matched text)',
      });
    }

    const hasLineRange = startLine != null || endLine != null;
    if (oldContent && hasLineRange) {
      return JSON.stringify({
        success: false,
        error:
          "Provide EITHER oldContent OR startLine/endLine, not both.",
      });
    }
    if (!oldContent && !hasLineRange) {
      return JSON.stringify({
        success: false,
        error:
          "Provide oldContent (text to replace) OR startLine and endLine (1-based, inclusive — from readFile's line numbers).",
      });
    }

    try {
      const current = await fs.readFile(filePath, "utf-8");

      if (hasLineRange) {
        return this.editByLineRange(filePath, current, startLine, endLine, newContent);
      }

      return this.editByContent(filePath, current, oldContent!, newContent);
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  private async editByLineRange(
    filePath: string,
    current: string,
    startLine: number | undefined,
    endLine: number | undefined,
    newContent: string,
  ): Promise<string> {
    const eol = current.includes("\r\n") ? "\r\n" : "\n";
    const lines = current.split(/\r?\n/);
    const total = lines.length;

    const valid =
      Number.isInteger(startLine) &&
      Number.isInteger(endLine) &&
      startLine! >= 1 &&
      startLine! <= total + 1 &&
      endLine! >= startLine! - 1 &&
      endLine! <= total;

    if (!valid) {
      return JSON.stringify({
        success: false,
        error: `Invalid range for a ${total}-line file. startLine must be 1-${total + 1}, endLine must be ${"startLine-1 (to insert) or between startLine and " + total}. To append, use startLine=${total + 1}, endLine=${total}.`,
      });
    }

    const before = lines.slice(0, startLine! - 1);
    const after = lines.slice(endLine!);
    const removedLines = lines.slice(startLine! - 1, endLine!);
    const replacement =
      newContent === "" ? [] : newContent.replace(/\r?\n/g, eol).split(eol);

    await fs.writeFile(filePath, [...before, ...replacement, ...after].join(eol));

    const isInsertion = endLine === startLine! - 1;
    return JSON.stringify({
      success: true,
      data: isInsertion
        ? `File ${filePath} edited: inserted content before line ${startLine} (file had ${total} lines).`
        : `File ${filePath} edited: replaced lines ${startLine}-${endLine} (of ${total}).`,
      diff: { old: removedLines.join("\n"), new: newContent },
    });
  }

  private async editByContent(
    filePath: string,
    current: string,
    oldContent: string,
    newContent: string,
  ): Promise<string> {
    const { old, next } = resolveEditMatch(current, oldContent, newContent);

    if (!current.includes(old)) {
      if (/^\s*\d+\|\s/m.test(oldContent)) {
        return JSON.stringify({
          success: false,
          error:
            'Your oldContent contains the "N| " line-number prefixes from readFile output. Those are display-only and not part of the file — send the raw text without them.',
        });
      }

      const lines = current.split(/\r?\n/);
      const oldLines = oldContent.split(/\r?\n/);

      if (oldLines.length > lines.length) {
        return JSON.stringify({
          success: false,
          error: `oldContent has ${oldLines.length} lines but the file only has ${lines.length}. You likely included readFile decorations like the "(End of file...)" hint — send only raw file text. For adding/removing whole lines, prefer startLine/endLine instead of oldContent — it avoids this mistake entirely.`,
        });
      }

      const region = closestRegion(current, oldContent);
      if (region) {
        return JSON.stringify({
          success: false,
          error: `old_text not found. The closest region starts at line ${region.line} and its EXACT content is:\n${region.text}\nRetry using this text verbatim as oldContent, or switch to startLine/endLine instead.`,
        });
      }

      return JSON.stringify({
        success: false,
        error:
          "old_text not found anywhere in the file — it may be from a different file or an outdated read. Re-read the file and use its current content.",
      });
    }

    const occurrences = current.split(old).length - 1;
    if (occurrences > 1) {
      return JSON.stringify({
        success: false,
        error: `oldContent appears ${occurrences} times — the edit is ambiguous. Include more surrounding context, or use startLine/endLine to target one location.`,
      });
    }

    await fs.writeFile(filePath, current.split(old).join(next));
    return JSON.stringify({
      success: true,
      data: `File ${filePath} edited successfully.`,
      diff: { old, new: next },
    });
  }

  processes = new Map<string, { pid: number; output: string }>();

  async startBackground({
    command,
    cwd,
  }: {
    command: string;
    cwd?: string;
  }): Promise<string> {
    const commandValidation = validateCommand(command);
    if (!commandValidation.valid) {
      return JSON.stringify({
        success: false,
        error: commandValidation.error,
      });
    }

    if (cwd) {
      const cwdValidation = validateFilePath(cwd);
      if (!cwdValidation.valid) {
        return JSON.stringify({ success: false, error: cwdValidation.error });
      }
    }

    const id = Date.now().toString();
    const entry = { pid: 0, output: "" };

    const child = spawn(command, {
      shell: true,
      cwd: cwd || process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (!child.pid) return `Failed to start: no PID`;

    entry.pid = child.pid;
    child.stdout?.on("data", (d) => (entry.output += d.toString()));
    child.stderr?.on("data", (d) => (entry.output += d.toString()));
    child.on("close", (code) => (entry.output += `\n[exited: ${code}]`));

    this.processes.set(id, entry);

    await new Promise((r) => setTimeout(r, 3000));
    return JSON.stringify({
      success: true,
      id,
      pid: child.pid,
      output: entry.output || "No output yet — process may still be starting",
    });
  }

  async readProcessOutput({ id }: { id: string }): Promise<string> {
    const proc = this.processes.get(id);
    if (!proc)
      return JSON.stringify({
        success: false,
        error: `Not found. Running: ${[...this.processes.keys()].join(", ") || "none"}`,
      });
    return JSON.stringify({
      success: true,
      output: proc.output || "No output yet",
    });
  }

  async stopProcess({ id }: { id: string }): Promise<string> {
    const proc = this.processes.get(id);
    if (!proc)
      return JSON.stringify({ success: false, error: "Process not found" });

    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", proc.pid.toString(), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(-proc.pid, "SIGTERM");
    }

    this.processes.delete(id);
    return JSON.stringify({ success: true, data: `Process ${id} stopped` });
  }

  async grep({
    filePath,
    query,
  }: {
    filePath: string;
    query: string;
  }): Promise<string> {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }

    if (!query || typeof query !== "string") {
      return JSON.stringify({
        success: false,
        error: "query must be a non-empty string",
      });
    }

    const MAX_MATCHES = 50;
    const needle = query.toLowerCase();
    const matches: { file: string; line: number; content: string }[] = [];

    const searchFile = async (fp: string) => {
      let content: string;
      try {
        content = await fs.readFile(fp, "utf-8");
      } catch {
        return; // unreadable/binary file — skip
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({
            file: path.relative(process.cwd(), fp) || fp,
            line: i + 1,
            content: lines[i].slice(0, 200),
          });
        }
      }
    };

    const walk = async (dir: string) => {
      if (matches.length >= MAX_MATCHES) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= MAX_MATCHES) break;
        if (IGNORE_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          await searchFile(full);
        }
      }
    };

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await walk(filePath);
      } else {
        await searchFile(filePath);
      }

      return JSON.stringify({
        success: true,
        total: matches.length,
        truncated: matches.length >= MAX_MATCHES,
        matches,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  async webSearch({ query }: { query: string }): Promise<string> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return JSON.stringify({
        success: false,
        error: "TAVILY_API_KEY environment variable not set",
      });
    }

    if (!query || typeof query !== "string" || query.length > 500) {
      return JSON.stringify({
        success: false,
        error: "Query must be a non-empty string (max 500 chars)",
      });
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: 5,
        }),
      });
      const data: any = await response.json();
      return JSON.stringify({
        success: true,
        answer: data.answer,
        results: data.results?.map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        })),
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }

  async fetchURL({
    url,
    method = "GET",
    body,
    headers,
  }: {
    url: string;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  }): Promise<any> {
    try {
      const upperMethod = method.toUpperCase();
      const hasBody = body && !["GET", "HEAD"].includes(upperMethod);
      const res = await fetch(url, {
        method: upperMethod,
        headers: { ...headers, ...(hasBody ? { "Content-Type": "application/json" } : {}) },
        body: hasBody ? body : undefined,
      });
      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      return {
        success: res.ok,
        status: res.status,
        statusText: res.statusText,
        data,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getLineCount({ filePath }: { filePath: string }): Promise<string> {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }

    try {
      const stats = await fs.stat(filePath);
      
      const lineCount = await new Promise<number>((resolve, reject) => {
        let count = 0;
        const stream = fsSync.createReadStream(filePath, { encoding: "utf8" });
        const rl = readline.createInterface({ input: stream });
        rl.on("line", () => count++);
        rl.on("close", () => resolve(count));
        rl.on("error", reject);
      });

      return JSON.stringify({
        success: true,
        data: {
          filePath,
          lineCount,
          fileSizeBytes: stats.size,
        },
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
  }
}

export const tools = new Tools();
