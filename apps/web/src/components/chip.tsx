import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "./icons.tsx";

export function SelectChip<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="chip">
      <span className="chip-key">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * How long typing must pause before the query is applied. Every applied query
 * refetches the Overview and History, so applying per keystroke launched one
 * full analysis per character; the stale-response guard in `app.tsx` kept the
 * result right but not the work.
 */
const SEARCH_DELAY_MS = 250;

export function SearchChip({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  // What was last handed to `onChange`, so an outside change (a reset) can be
  // told apart from the echo of our own.
  const sent = useRef(value);
  // Held in a ref so a parent re-render, which builds a fresh callback, does
  // not restart the pause.
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [value]);
  useEffect(() => {
    if (text === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = text;
      latest.current(text);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <label className="chip chip-search">
      <SearchIcon />
      <input
        type="search"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setText(event.target.value)}
      />
    </label>
  );
}
