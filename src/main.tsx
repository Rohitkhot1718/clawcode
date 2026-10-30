import { render } from "ink";
import App from "./ui/App";

const args = process.argv.slice(2);
const flag = args.findIndex((a) => a === "--resume" || a === "-r");
const next = flag >= 0 ? args[flag + 1] : undefined;
const resume: string | true | undefined =
  flag < 0 ? undefined : next && !next.startsWith("-") ? next : true;

render(<App resume={resume} />, { exitOnCtrlC: false });
