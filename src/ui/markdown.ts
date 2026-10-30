import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

marked.setOptions({
  // @ts-ignore - marked-terminal's types can lag behind marked's
  renderer: new TerminalRenderer(),
});

export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text) as string;
  return rendered.replace(/\n{3,}/g, "\n\n").trim();
}