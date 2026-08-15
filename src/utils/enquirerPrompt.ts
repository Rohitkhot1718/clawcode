import Enquirer from "enquirer";

const enquirer = new Enquirer();

// Set to true for the duration of an active enquirer prompt. Consumers
// (e.g. the global Ctrl+C keypress handler in index.ts) check this so they
// don't act on a keystroke that Enquirer's own prompt UI is already
// handling — Enquirer takes over stdin, hides the cursor, and renders a
// custom UI while a prompt is open, so racing it with process.exit()
// leaves the terminal visually corrupted.
export let promptActive = false;

// Enquirer leaves stdin in raw mode after a prompt closes. If nothing else
// is reading stdin afterwards, the process exits while stdin is still raw,
// which corrupts the parent terminal (no echo, broken backspace/arrows)
// until the user runs `reset`/`stty sane` or opens a new terminal. Restore
// whatever raw-mode state stdin had *before* the prompt started — this
// correctly leaves it off for one-shot CLI commands and on for prompts
// invoked mid-REPL (where the global keypress handler has already turned
// raw mode on for the process lifetime and expects it to stay on).
export async function prompt(options: any) {
  const wasRaw = process.stdin.isTTY ? process.stdin.isRaw ?? false : false;
  promptActive = true;
  try {
    return await enquirer.prompt(options);
  } catch {
    clearLine();
    console.log("Cancelled.");
    return null;
  } finally {
    promptActive = false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(wasRaw);
    }
  }
}

export function clearLine() {
  process.stdout.write("\x1B[1A\x1B[2K");
}