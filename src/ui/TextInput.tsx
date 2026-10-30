import { useEffect, useRef, useState } from "react";
import { Text, useInput } from "ink";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  mask?: string;
};

export default function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  mask,
}: Props) {
  const valueRef = useRef(value);
  const cursorRef = useRef(value.length);
  const emitted = useRef<string[]>([]);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (value === valueRef.current) {
      emitted.current = [];
      return;
    }
    if (emitted.current.includes(value)) return;
    valueRef.current = value;
    cursorRef.current = value.length;
    emitted.current = [];
    rerender((n) => n + 1);
  }, [value]);

  const commit = (next: string, cursor: number) => {
    const changed = next !== valueRef.current;
    valueRef.current = next;
    cursorRef.current = Math.max(0, Math.min(cursor, next.length));
    if (changed) {
      emitted.current.push(next);
      onChange(next);
    }
    rerender((n) => n + 1);
  };

  useInput(
    (input, key) => {
      if (
        key.upArrow ||
        key.downArrow ||
        key.tab ||
        key.escape ||
        (key.ctrl && input === "c")
      ) {
        return;
      }

      const current = valueRef.current;
      const cursor = cursorRef.current;

      if (key.return) {
        onSubmit?.(current);
        return;
      }
      if (key.leftArrow) return commit(current, cursor - 1);
      if (key.rightArrow) return commit(current, cursor + 1);
      if (key.ctrl && input === "a") return commit(current, 0);
      if (key.ctrl && input === "e") return commit(current, current.length);
      if (key.ctrl && input === "u") return commit(current.slice(cursor), 0);

      if (key.backspace || key.delete) {
        if (cursor === 0) return;
        return commit(current.slice(0, cursor - 1) + current.slice(cursor), cursor - 1);
      }

      if (key.ctrl || key.meta || !input) return;

      const text = input.replace(/[\r\n]+/g, " ");
      commit(current.slice(0, cursor) + text + current.slice(cursor), cursor + text.length);
    },
    { isActive: focus },
  );

  const shown = mask ? mask.repeat(valueRef.current.length) : valueRef.current;
  const cursor = Math.min(cursorRef.current, shown.length);

  if (!shown) {
    if (!focus) return <Text dimColor>{placeholder}</Text>;
    return (
      <Text>
        <Text inverse>{placeholder[0] ?? " "}</Text>
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  return (
    <Text>
      {shown.slice(0, cursor)}
      {focus ? <Text inverse>{shown[cursor] ?? " "}</Text> : shown[cursor] ?? ""}
      {shown.slice(cursor + 1)}
    </Text>
  );
}
