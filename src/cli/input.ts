import readline from "readline";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { IGNORE_DIRS } from "../tools/index.js";

interface Suggestion {
  name: string;
  isDir: boolean;
  insertText: string;
}

const MAX_SUGGESTIONS = 200;
const VISIBLE_SUGGESTIONS = 10;
const history: string[] = [];

function listMatches(partial: string, cwd: string): Suggestion[] {
  const normalized = partial.replace(/\\/g, "/");
  const slashIdx = normalized.lastIndexOf("/");
  const dirPart = slashIdx === -1 ? "" : normalized.slice(0, slashIdx + 1);
  const prefix = slashIdx === -1 ? normalized : normalized.slice(slashIdx + 1);
  const searchDir = path.resolve(cwd, dirPart || ".");

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(searchDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (e) =>
        !e.name.startsWith(".") &&
        !(e.isDirectory() && IGNORE_DIRS.has(e.name)) &&
        e.name.toLowerCase().startsWith(prefix.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_SUGGESTIONS)
    .map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      insertText: dirPart + e.name + (e.isDirectory() ? "/" : ""),
    }));
}

// Raw mode and keypress decoding are set up once, globally, at process
// startup (see index.ts) and left on for the whole process lifetime — this
// function only ever adds/removes its own listener on top of that, it never
// touches raw mode itself. (Toggling raw mode on/off per call used to live
// here and caused intermittent input breakage.)
export function askInput(promptText = "> "): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    let buffer = "";
    let cursor = 0;
    let suggestions: Suggestion[] = [];
    let selected = 0;
    let scrollOffset = 0;
    let mentionStart = -1;
    let renderedExtraLines = 0;
    let historyIndex = history.length;
    let draft = "";
    let finished = false;

    function findMentionStart(): number {
      for (let i = cursor - 1; i >= 0; i--) {
        const ch = buffer[i];
        if (ch === "@") {
          if (i === 0 || /\s/.test(buffer[i - 1])) return i;
          return -1;
        }
        if (/\s/.test(ch)) return -1;
      }
      return -1;
    }

    function updateSuggestions() {
      mentionStart = findMentionStart();
      if (mentionStart === -1) {
        suggestions = [];
        selected = 0;
        return;
      }
      const partial = buffer.slice(mentionStart + 1, cursor);
      suggestions = listMatches(partial, process.cwd());
      if (selected >= suggestions.length) selected = 0;
      scrollOffset = 0;
    }

    function scrollToSelected() {
      if (selected < scrollOffset) {
        scrollOffset = selected;
      } else if (selected >= scrollOffset + VISIBLE_SUGGESTIONS) {
        scrollOffset = selected - VISIBLE_SUGGESTIONS + 1;
      }
    }

    function render() {
      process.stdout.write("\r\x1b[0J");
      process.stdout.write(chalk.cyan(promptText) + buffer);

      renderedExtraLines = 0;
      if (suggestions.length) {
        if (scrollOffset > 0) {
          process.stdout.write("\n" + chalk.gray(`  ↑ ${scrollOffset} more`));
          renderedExtraLines++;
        }

        const windowEnd = Math.min(
          suggestions.length,
          scrollOffset + VISIBLE_SUGGESTIONS,
        );
        for (let i = scrollOffset; i < windowEnd; i++) {
          const s = suggestions[i];
          const label = s.name + (s.isDir ? "/" : "");
          const colored = s.isDir ? chalk.blueBright(label) : chalk.white(label);
          const row = i === selected ? chalk.inverse(` ${label} `) : `  ${colored}`;
          process.stdout.write("\n" + row);
          renderedExtraLines++;
        }

        const remaining = suggestions.length - windowEnd;
        if (remaining > 0) {
          process.stdout.write("\n" + chalk.gray(`  ↓ ${remaining} more`));
          renderedExtraLines++;
        }
      }

      if (renderedExtraLines > 0) {
        process.stdout.write(`\x1b[${renderedExtraLines}A`);
      }
      process.stdout.write("\r");
      const col = promptText.length + cursor;
      if (col > 0) process.stdout.write(`\x1b[${col}C`);
    }

    function acceptSuggestion() {
      if (mentionStart === -1 || !suggestions.length) return;
      const s = suggestions[selected];
      const insert = "@" + s.insertText;
      buffer = buffer.slice(0, mentionStart) + insert + buffer.slice(cursor);
      cursor = mentionStart + insert.length;
      updateSuggestions();
      render();
    }

    function cleanup() {
      finished = true;
      stdin.removeListener("keypress", onKeypress);
    }

    function finish(value: string) {
      suggestions = [];
      render();
      cleanup();
      process.stdout.write("\n");
      resolve(value);
    }

    // Ctrl+C is handled by the single global listener in index.ts, not here.
    function onKeypress(str: string, key: readline.Key) {
      if (finished) return;

      if (key.name === "return" || key.name === "enter") {
        if (suggestions.length) {
          acceptSuggestion();
          return;
        }
        const value = buffer.trim();
        if (value) {
          history.push(value);
        }
        finish(value);
        return;
      }

      if (key.name === "tab") {
        if (suggestions.length) acceptSuggestion();
        return;
      }

      if (key.name === "escape") {
        if (suggestions.length) {
          suggestions = [];
          render();
        }
        return;
      }

      if (key.name === "up") {
        if (suggestions.length) {
          selected = (selected - 1 + suggestions.length) % suggestions.length;
          scrollToSelected();
          render();
        } else if (historyIndex > 0) {
          if (historyIndex === history.length) draft = buffer;
          historyIndex--;
          buffer = history[historyIndex];
          cursor = buffer.length;
          updateSuggestions();
          render();
        }
        return;
      }

      if (key.name === "down") {
        if (suggestions.length) {
          selected = (selected + 1) % suggestions.length;
          scrollToSelected();
          render();
        } else if (historyIndex < history.length) {
          historyIndex++;
          buffer = historyIndex === history.length ? draft : history[historyIndex];
          cursor = buffer.length;
          updateSuggestions();
          render();
        }
        return;
      }

      if (key.name === "left") {
        if (cursor > 0) cursor--;
        updateSuggestions();
        render();
        return;
      }

      if (key.name === "right") {
        if (cursor < buffer.length) cursor++;
        updateSuggestions();
        render();
        return;
      }

      if (key.name === "backspace") {
        if (cursor > 0) {
          buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
          cursor--;
        }
        updateSuggestions();
        render();
        return;
      }

      if (key.name === "delete") {
        buffer = buffer.slice(0, cursor) + buffer.slice(cursor + 1);
        updateSuggestions();
        render();
        return;
      }

      if (key.ctrl || key.meta) return;

      if (str && !/^f\d{1,2}$/.test(key.name ?? "")) {
        buffer = buffer.slice(0, cursor) + str + buffer.slice(cursor);
        cursor += str.length;
        updateSuggestions();
        render();
      }
    }

    stdin.on("keypress", onKeypress);
    render();
  });
}
