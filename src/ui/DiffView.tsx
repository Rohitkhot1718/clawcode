import React from "react";
import { Box, Text } from "ink";
import { diffLines } from "diff";

interface DiffViewProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  contextLines?: number;
}

type Row = { type: "add" | "remove" | "context"; lineNo: number; text: string };
type DisplayItem = Row | { type: "gap"; count: number };

export function DiffView({ filePath, oldContent, newContent, contextLines = 3 }: DiffViewProps) {
  const changes = diffLines(oldContent, newContent);
  let addedCount = 0;
  let removedCount = 0;
  let oldLineNo = 1;
  let newLineNo = 1;
  const rows: Row[] = [];

  for (const part of changes) {
    const lines = part.value.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && part.value.endsWith("\n")));
    for (const line of lines) {
      if (part.added) {
        addedCount++;
        rows.push({ type: "add", lineNo: newLineNo++, text: line });
      } else if (part.removed) {
        removedCount++;
        rows.push({ type: "remove", lineNo: oldLineNo++, text: line });
      } else {
        rows.push({ type: "context", lineNo: newLineNo, text: line });
        oldLineNo++;
        newLineNo++;
      }
    }
  }

  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.type !== "context") {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(rows.length - 1, i + contextLines); j++) {
        keep[j] = true;
      }
    }
  });

  const display: DisplayItem[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      display.push(rows[i]);
      i++;
    } else {
      let count = 0;
      while (i < rows.length && !keep[i]) {
        count++;
        i++;
      }
      if (count > 0) display.push({ type: "gap", count });
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box paddingLeft={2}>
        <Text color="gray">
          Added <Text color="green">{addedCount}</Text> {addedCount === 1 ? "line" : "lines"}, removed{" "}
          <Text color="red">{removedCount}</Text> {removedCount === 1 ? "line" : "lines"}
        </Text>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {display.map((item, i) => {
          if (item.type === "gap") {
            return (
              <Text key={i} color="gray" dimColor>
                {"    ..."}
              </Text>
            );
          }
          const prefix = item.type === "add" ? "+" : item.type === "remove" ? "-" : " ";
          const color = item.type === "add" ? "green" : item.type === "remove" ? "red" : "white";
          return (
            <Text key={i}>
              <Text color="gray">{String(item.lineNo).padStart(4, " ")} </Text>
              <Text color={color}>{prefix} {item.text}</Text>
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}