// SPDX-License-Identifier: Apache-2.0
// My layout's own objects: areas (a titled, dashed container the person drew, holding
// sessions by key) and notes (plain text). Both edit in place: Enter commits a title,
// ⌘↵ a note (Enter is a newline there), Esc cancels, leaving the field commits.
import type { LabelColor } from "@sessionpipe-gui/theme-types/api";
import { type Area, NOTE_MAX, type Note, TITLE_MAX } from "./types";
import { el, setClass, setText } from "./util";

/** Edits `field` in place; resolves with the new text, or null when cancelled. */
export function editInline(field: HTMLElement, opts: { multiline: boolean; max: number }): Promise<string | null> {
  return new Promise((resolve) => {
    const before = field.textContent ?? "";
    try {
      field.contentEditable = "plaintext-only";
    } catch {
      field.contentEditable = "true";
    }
    if (field.contentEditable !== "plaintext-only") field.contentEditable = "true";
    field.spellcheck = opts.multiline;
    field.classList.add("is-editing");
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(field);
    if (opts.multiline && !before) range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      field.removeEventListener("keydown", onKey);
      field.removeEventListener("blur", onBlur);
      field.removeEventListener("input", onInput);
      field.contentEditable = "false";
      field.classList.remove("is-editing");
      getSelection()?.removeAllRanges();
      if (value === null) field.textContent = before;
      resolve(value);
    };
    const read = () => (opts.multiline ? field.innerText : (field.textContent ?? "").replace(/\s+/g, " ")).trim();
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
        field.blur();
      } else if (e.key === "Enter" && (!opts.multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish(read());
        field.blur();
      }
    };
    const onBlur = () => finish(read());
    // A pasted novel stops at the limit.
    const onInput = () => {
      const t = field.innerText;
      if (t.length > opts.max) field.innerText = t.slice(0, opts.max);
    };
    field.addEventListener("keydown", onKey);
    field.addEventListener("blur", onBlur);
    field.addEventListener("input", onInput);
  });
}

export class AreaView {
  readonly el: HTMLElement;
  readonly title: HTMLElement;
  private dot: HTMLElement;
  private count: HTMLElement;
  editing = false;

  constructor(readonly id: string) {
    this.el = el("div", "cv-area");
    this.el.dataset.area = id;
    this.el.setAttribute("role", "group");
    const head = el("div", "cv-area-head");
    this.dot = el("span", "label-dot cv-area-dot");
    this.dot.hidden = true;
    this.title = el("span", "cv-area-title");
    this.count = el("span", "cv-area-n num");
    head.append(this.dot, this.title, this.count);
    head.tabIndex = 0;
    const resize = el("div", "cv-area-resize");
    resize.setAttribute("aria-hidden", "true");
    this.el.append(head, resize);
  }

  update(a: Area, members: number, names: Record<LabelColor, string> | undefined) {
    if (!this.editing) setText(this.title, a.title || "Untitled area");
    setText(this.count, members ? String(members) : "");
    if (a.label) {
      this.dot.className = `label-dot label-dot--${a.label} cv-area-dot`;
      this.dot.title = `Label: ${names?.[a.label] ?? a.label}`;
    }
    this.dot.hidden = !a.label;
    this.el.dataset.label = a.label ?? "";
    setClass(this.el, "is-labelled", !!a.label);
    this.el.setAttribute(
      "aria-label",
      `Area ${a.title || "Untitled area"}, ${members} session${members === 1 ? "" : "s"}`,
    );
    this.place(a);
  }

  place(r: { x: number; y: number; w: number; h: number; z?: number }) {
    this.el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
    this.el.style.width = `${r.w}px`;
    this.el.style.height = `${r.h}px`;
  }

  async rename(): Promise<string | null> {
    this.editing = true;
    if (!this.title.textContent || this.title.textContent === "Untitled area") this.title.textContent = "";
    const v = await editInline(this.title, { multiline: false, max: TITLE_MAX });
    this.editing = false;
    return v;
  }

  destroy() {
    this.el.remove();
  }
}

export class NoteView {
  readonly el: HTMLElement;
  readonly text: HTMLElement;
  private dot: HTMLElement;
  editing = false;

  constructor(readonly id: string) {
    this.el = el("div", "cv-note");
    this.el.dataset.note = id;
    this.el.tabIndex = 0;
    this.el.setAttribute("role", "note");
    this.dot = el("span", "label-dot cv-note-dot");
    this.dot.hidden = true;
    this.text = el("div", "cv-note-text");
    const resize = el("div", "cv-note-resize");
    resize.setAttribute("aria-hidden", "true");
    this.el.append(this.dot, this.text, resize);
  }

  update(n: Note, names: Record<LabelColor, string> | undefined) {
    if (!this.editing && this.text.textContent !== n.text) this.text.textContent = n.text;
    if (n.label) {
      this.dot.className = `label-dot label-dot--${n.label} cv-note-dot`;
      this.dot.title = `Label: ${names?.[n.label] ?? n.label}`;
    }
    this.dot.hidden = !n.label;
    this.el.dataset.label = n.label ?? "";
    setClass(this.el, "is-labelled", !!n.label);
    this.el.setAttribute("aria-label", n.text ? `Note: ${n.text.slice(0, 80)}` : "Empty note");
    this.place(n);
  }

  place(r: { x: number; y: number; w: number; h: number }) {
    this.el.style.transform = `translate3d(${r.x}px, ${r.y}px, 0)`;
    this.el.style.width = `${r.w}px`;
    this.el.style.height = `${r.h}px`;
  }

  async edit(): Promise<string | null> {
    this.editing = true;
    setClass(this.el, "is-editing", true);
    const v = await editInline(this.text, { multiline: true, max: NOTE_MAX });
    this.editing = false;
    setClass(this.el, "is-editing", false);
    return v;
  }

  destroy() {
    this.el.remove();
  }
}
