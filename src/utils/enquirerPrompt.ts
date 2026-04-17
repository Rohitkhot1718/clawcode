import Enquirer from "enquirer";

const enquirer = new Enquirer();

export async function prompt(options: any) {
  try {
    return await enquirer.prompt(options);
  } catch {
    clearLine();
    console.log("Cancelled.");
    return null;
  }
}

export function clearLine() {
  process.stdout.write("\x1B[1A\x1B[2K");
}