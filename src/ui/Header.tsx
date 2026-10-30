import { useMemo } from "react";
import { Box, Text } from "ink";
import { readFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import type { ModelConfig } from "../config/index";
import { loadMemorySync } from "../memory/memory";
import { loadSkills } from "../skills/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8"),
    );
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = readVersion();

function shortPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Box width={9}>
        <Text dimColor>{label}</Text>
      </Box>
      <Text>{children}</Text>
    </Box>
  );
}

export function Header({
  model,
  loading,
  width,
}: {
  model: ModelConfig | null;
  loading: boolean;
  width: number;
}) {
  const stats = useMemo(() => {
    const notes = loadMemorySync().split("\n").filter((l) => l.trim()).length;
    return { notes, skills: loadSkills().length };
  }, [model?.id]);

  const boxWidth = Math.min(width, 72);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="magenta"
        paddingX={1}
        width={boxWidth}
      >
        <Text>
          <Text color="magenta" bold>
            {"✦ Clawcode"}
          </Text>
          <Text dimColor>{"  v" + VERSION}</Text>
        </Text>
        <Text dimColor>AI coding agent for your terminal</Text>
        <Box marginTop={1} flexDirection="column">
          <Row label="Model">
            {loading ? (
              <Text dimColor>loading…</Text>
            ) : model ? (
              <Text>
                {model.name}
                <Text dimColor>{" · " + model.provider}</Text>
              </Text>
            ) : (
              <Text color="yellow">not configured, run /config</Text>
            )}
          </Row>
          <Row label="Folder">{shortPath(process.cwd())}</Row>
          <Row label="Context">
            {stats.notes} {stats.notes === 1 ? "note" : "notes"} · {stats.skills}{" "}
            {stats.skills === 1 ? "skill" : "skills"}
          </Row>
        </Box>
      </Box>
      <Text dimColor>
        {" /help commands · @ files · esc to interrupt"}
      </Text>
    </Box>
  );
}
