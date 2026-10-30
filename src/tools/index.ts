import fs from "fs/promises";
import fg from "fast-glob";
import { rgPath } from "@vscode/ripgrep";
import { spawn, execSync, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  flushPendingEvents,
  isRunning,
  messages,
  runTurn,
  type AgentEvent,
} from "../agent/agent";

type BackgroundTask = {
  process: ChildProcess;
  output: string;
  error: string;
  status: "running" | "completed" | "failed";
};

type BackgroundTaskEvent = {
  taskId: string;
  output: string;
  error: string;
  status: "running" | "completed" | "failed";
};

export type ToolResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

export class Tools {
  bgEventHandler: ((event: AgentEvent) => void) | null = null;
  askUserHandler: ((questions: any[]) => Promise<string>) | null = null;
  pendingEvents: BackgroundTaskEvent[] = [];
  private tasks = new Map<string, BackgroundTask>();

  setBgEventHandler(handler: (event: AgentEvent) => void) {
    this.bgEventHandler = handler;
  }

  setAskUserQuestionHandler(handler: (questions: any[]) => Promise<string>) {
    this.askUserHandler = handler;
  }

  private handleTaskEvents(event: BackgroundTaskEvent) {
    this.pendingEvents.push(event);

    if (!isRunning) {
      flushPendingEvents(messages);
      runTurn(messages, this.bgEventHandler!).catch(console.error);
    }
  }

  private resolveBashPath(): string {
    if (process.platform !== "win32") return "bash";
    try {
      const gitPaths = execSync("where git", {
        encoding: "utf-8",
        shell: "cmd.exe",
      })
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);

      for (const gitPath of gitPaths) {
        let dir = path.dirname(gitPath);
        for (let i = 0; i < 3; i++) {
          const candidate = path.join(dir, "bin", "bash.exe");
          if (existsSync(candidate)) return candidate;
          dir = path.dirname(dir);
        }
      }
    } catch {}
    return "bash";
  }

  private runBackgroundTask(process: ChildProcess): string {
    const taskId = crypto.randomUUID();

    const task: BackgroundTask = {
      process,
      output: "",
      error: "",
      status: "running",
    };

    this.tasks.set(taskId, task);

    process.stdout?.on("data", (chunk) => {
      task.output += chunk.toString();
    });

    process.stderr?.on("data", (chunk) => {
      task.error += chunk.toString();
    });

    process.on("error", (err) => {
      task.status = "failed";
      task.error = err.message;

      this.handleTaskEvents({
        taskId,
        output: task.output,
        error: task.error,
        status: task.status,
      });
    });

    process.on("close", (code) => {
      task.status = code === 0 ? "completed" : "failed";

      this.handleTaskEvents({
        taskId,
        output: task.output,
        error: task.error,
        status: task.status,
      });
    });

    return taskId;
  }

  async readFile(
    path: string,
    offset: number,
    limit: number,
  ): Promise<ToolResult> {
    let content: string;
    try {
      content = await fs.readFile(path, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT")
        return { ok: false, error: `File does not exist: ${path}` };
      if (err.code === "EISDIR")
        return { ok: false, error: `Path is a directory, not a file: ${path}` };
      return { ok: false, error: `Failed to read file: ${err.message}` };
    }

    const lines = content.split("\n");
    const output = lines
      .slice(offset, offset + limit)
      .map((line, i) => `${offset + i + 1}\t${line}`)
      .join("\n");

    return { ok: true, output };
  }

  async writeFile(path: string, content: string): Promise<ToolResult> {
    try {
      await fs.writeFile(path, content, "utf-8");
      return {
        ok: true,
        output: `File write succeeded. (file state is current in your context — no need to Read it back)`,
      };
    } catch (error: any) {
      return { ok: false, error: `Failed to write file: ${error.message}` };
    }
  }

  async editFile(
    path: string,
    oldStr: string,
    newStr: string,
    replaceAll = false,
  ): Promise<ToolResult> {
    let content;
    try {
      content = await fs.readFile(path, "utf-8");
    } catch (error: any) {
      return {
        ok: false,
        error: `Failed to read file while updating: ${error.message}`,
      };
    }

    const occurrences = content.split(oldStr).length - 1;

    if (occurrences === 0)
      return {
        ok: false,
        error: `String to replace not found in file. String: ${oldStr}`,
      };

    if (occurrences > 1 && !replaceAll)
      return {
        ok: false,
        error: `Found ${occurrences} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance. String: ${oldStr}`,
      };

    const updated = replaceAll
      ? content.split(oldStr).join(newStr)
      : content.replace(oldStr, newStr);
    try {
      await fs.writeFile(path, updated, "utf-8");
      return {
        ok: true,
        output: `The file ${path} has been updated successfully. (file state is current in your context — no need to Read it back)`,
      };
    } catch (error: any) {
      return { ok: false, error: `Failed to write file: ${error.message}` };
    }
  }

  async glob(pattern: string, path?: string): Promise<ToolResult> {
    const cwd = path || process.cwd();
    try {
      await fs.access(cwd);
    } catch {
      return { ok: false, error: `Path does not exist: ${cwd}` };
    }
    try {
      const files = await fg(pattern, {
        cwd,
        onlyFiles: true,
        dot: false,
        ignore: ["node_modules/**", ".git/**", "dist/**", "build/**"],
      });
      return { ok: true, output: files.join("\n") };
    } catch (error: any) {
      return { ok: false, error: `Failed to glob files: ${error.message}` };
    }
  }

  async grep(query: string, path: string): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      const rg = spawn(rgPath, [
        query,
        path,
        "-n",
        "-g",
        "!node_modules/**",
        "-g",
        "!.git/**",
        "-g",
        "!dist/**",
        "-g",
        "!build/**",
      ]);

      let output = "";
      let error = "";

      rg.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });

      rg.stderr.on("data", (chunk) => {
        error += chunk.toString();
      });

      rg.on("error", (err) => {
        resolve({ ok: false, error: err.message });
      });

      rg.on("close", (code) => {
        if (code === 0 || code === 1) {
          resolve({ ok: true, output });
          return;
        }

        resolve({ ok: false, error });
      });
    });
  }

  async powerShell(
    command: string,
    runInBackground = false,
  ): Promise<ToolResult> {
    return new Promise((resolve) => {
      const ps = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        command,
      ]);

      let output = "";
      let error = "";

      if (runInBackground) {
        const taskId = this.runBackgroundTask(ps);

        resolve({
          ok: true,
          output: JSON.stringify({ taskId, status: "running" }),
        });
        return;
      }

      ps.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });

      ps.stderr.on("data", (chunk) => {
        error += chunk.toString();
      });

      ps.on("error", (err) => {
        resolve({
          ok: false,
          error: `Failed to start PowerShell: ${err.message}`,
        });
      });

      ps.on("close", (code) => {
        resolve(
          code === 0
            ? { ok: true, output }
            : {
                ok: false,
                error: `Command failed (code ${code}): ${error || output}`,
              },
        );
      });
    });
  }

  async bash(command: string, runInBackground = false): Promise<ToolResult> {
    return new Promise((resolve) => {
      const sh = spawn(this.resolveBashPath(), ["-c", command]);

      let output = "";
      let error = "";

      if (runInBackground) {
        const taskId = this.runBackgroundTask(sh);

        resolve({
          ok: true,
          output: JSON.stringify({ taskId, status: "running" }),
        });
        return;
      }

      sh.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });

      sh.stderr.on("data", (chunk) => {
        error += chunk.toString();
      });

      sh.on("error", (err) => {
        resolve({ ok: false, error: `Failed to start bash: ${err.message}` });
      });

      sh.on("close", (code) => {
        resolve(
          code === 0
            ? { ok: true, output }
            : {
                ok: false,
                error: `Command failed (code ${code}): ${error || output}`,
              },
        );
      });
    });
  }

  async askUserQuestion(questions: any[]): Promise<ToolResult> {
    if (!this.askUserHandler) {
      return {
        ok: false,
        error: "No UI is registered to ask the user a question.",
      };
    }
    const answer = await this.askUserHandler(questions);
    return { ok: true, output: answer };
  }
}

export const toolImpl = new Tools();
