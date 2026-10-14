// SPDX-License-Identifier: Apache-2.0
// j/k (or the arrows) move a cursor through a list, Enter opens the item under it: the
// GUI's useListNav, with `open` in place of the router. Esc is the host's (it clicks
// [data-dismiss], else goes back), and `/` does nothing here.
import { useCallback, useEffect, useState } from "react";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

export function useListNav<T>(items: readonly T[], open: (item: T) => void, enabled = true) {
  const [cursor, setCursor] = useState(-1);
  useEffect(() => {
    if (cursor >= items.length) setCursor(items.length - 1);
  }, [items.length, cursor]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(items.length - 1, c + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === "Enter") {
        const item = items[cursor];
        if (item !== undefined) {
          e.preventDefault();
          open(item);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, cursor, enabled, open]);

  useEffect(() => {
    if (cursor < 0) return;
    const el = document.querySelector<HTMLElement>(`.sp-office [data-cursor="${CSS.escape(String(cursor))}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const reset = useCallback(() => setCursor(-1), []);
  return { cursor, reset };
}
