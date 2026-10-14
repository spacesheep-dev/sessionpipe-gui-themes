// SPDX-License-Identifier: Apache-2.0
// Small pieces the GUI has and the ThemeApi does not: links that go through the host's
// router, a segmented control, and redaction highlighting.
import type { SessionKey } from "@sessionpipe-gui/theme-types/api";
import { type CSSProperties, type MouseEvent, type ReactNode, useId } from "react";
import { useApi } from "./api";

const plainClick = (e: MouseEvent<HTMLAnchorElement>) =>
  !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

interface LinkProps {
  children: ReactNode;
  className?: string;
  title?: string;
  "aria-label"?: string;
  "data-cursor"?: string;
  style?: CSSProperties;
}

/** An anchor to a session: a real href for the browser, api.openSession for a plain click. */
export function SessionLink({ to, href, children, ...rest }: LinkProps & { to: SessionKey; href: string }) {
  const api = useApi();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    api.openSession(to);
  };
  return (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}

/** An anchor to another page of the GUI, through api.navigate. */
export function NavLink({ to, children, ...rest }: LinkProps & { to: string }) {
  const api = useApi();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    api.navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    <fieldset className="seg">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={String(o.value)} className={`seg-opt ${o.value === value ? "seg-on" : ""}`} title={o.title}>
          <input
            type="radio"
            name={name}
            value={String(o.value)}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

const REDACTED = /(\[redacted\])/gi;

/** Text with every `[redacted]` placeholder highlighted. */
export function Redacted({ text }: { text: string }) {
  if (!REDACTED.test(text)) return <>{text}</>;
  REDACTED.lastIndex = 0;
  const parts = text.split(REDACTED);
  return (
    <>
      {parts.map((p, i) =>
        REDACTED.test(p) ? (
          <mark key={i} title="Removed on the sending machine by the secrets ruleset">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
