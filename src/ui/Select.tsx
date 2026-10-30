import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "./TextInput";

type Option = {
  label: string;
  description: string;
  custom?: true;
  value?: string;
};

type SelectProps = {
  label: string;
  options: Option[];
  onSelect: (option: Option) => void;
  onCancel?: () => void;
};

export function Select({ label, options, onSelect, onCancel }: SelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [customValue, setCustomValue] = useState("");
  useInput((_, key) => {
    if (key.upArrow) {
      setSelectedIndex((index) =>
        index === 0 ? options.length - 1 : index - 1,
      );
    }

    if (key.downArrow) {
      setSelectedIndex((index) =>
        index === options.length - 1 ? 0 : index + 1,
      );
    }

    if (key.return) {
      const option = options[selectedIndex];

      if (option.custom) {
        onSelect({
          ...option,
          label: customValue,
        });
      } else {
        onSelect(option);
      }
    }

    if (key.escape) {
      onCancel?.();
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{label + "\n"}</Text>
      {options.map((option, index) => {
        const selected = index === selectedIndex;

        return (
          <Box key={index} flexDirection="column">
            {option.custom && selected ? (
              <Box>
                <Text color="cyan">❯ {index + 1}. </Text>

                <TextInput
                  value={customValue}
                  onChange={setCustomValue}
                  placeholder="Type something."
                />
              </Box>
            ) : (
              <>
                <Text color={selected ? "cyan" : undefined}>
                  {selected ? "❯ " : "  "}
                  {index + 1}.{" "}
                  {option.custom ? customValue || option.label : option.label}
                </Text>

                <Text dimColor>{"     " + option.description}</Text>
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
