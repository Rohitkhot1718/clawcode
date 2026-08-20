import Enquirer from "enquirer";

const enquirer = new Enquirer();

export let promptActive = false;

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
      if (wasRaw) {
        process.stdin.resume();
      }
    }
  }
}

export function clearLine() {
  process.stdout.write("\x1B[1A\x1B[2K");
}