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
      // stdin "ignore": a command that waits for interactive input (e.g. a
      // `del` folder confirmation) gets immediate EOF instead of hanging the
      // agent forever on a pipe nothing writes to.
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
      const lines = content.split("\n");
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
  }: {
    filePath: string;
    oldContent: string;
    newContent: string;
  }): Promise<string> {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      return JSON.stringify({ success: false, error: validation.error });
    }

    if (!oldContent || !newContent) {
      return JSON.stringify({
        success: false,
        error: "oldContent and newContent are required",
      });
    }

    try {
      const current = await fs.readFile(filePath, "utf-8");
      if (!current.includes(oldContent)) {
        const lines = current.split("\n");
        const oldLines = oldContent.split("\n");
        let bestScore = 0,
          bestLine = 0;
        for (let i = 0; i <= lines.length - oldLines.length; i++) {
          const window = lines.slice(i, i + oldLines.length).join("\n");
          const score =
            window.split("").filter((c, j) => c === oldContent[j]).length /
            oldContent.length;
          if (score > bestScore) {
            bestScore = score;
            bestLine = i + 1;
          }
        }
        return JSON.stringify({
          success: false,
          error: `old_text not found. Best match at line ${bestLine} (${Math.round(bestScore * 100)}% similar). Re-read that section first.`,
        });
      }

      const occurrences = current.split(oldContent).length - 1;
      if (occurrences > 1) {
        return JSON.stringify({
          success: false,
          error: `oldContent appears ${occurrences} times — the edit is ambiguous. Include more surrounding context so it matches exactly one location.`,
        });
      }

      // split/join instead of String.replace so $-sequences in newContent
      // (e.g. $&, $1) are inserted literally rather than interpreted.
      await fs.writeFile(filePath, current.split(oldContent).join(newContent));
      return JSON.stringify({
        success: true,
        data: `File ${filePath} edited successfully.`,
      });
    } catch (error: any) {
      return JSON.stringify({ success: false, error: error.message });
    }
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
