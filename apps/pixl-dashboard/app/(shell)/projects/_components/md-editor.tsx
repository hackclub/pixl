"use client";

// Markdown textarea with a formatting bar, image upload/paste and a safe
// preview (components/markdown.tsx renders React elements, never HTML).
import { useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { textareaField } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { countJournalImages, journalCharsNeeded, journalImagesNeeded, journalTextLength } from "../format";
import { clipboardImage } from "./file-button";
import { hint } from "./styles";
import { uploadImageFile } from "./upload";

const mdBtn = cn(
  "border-2 border-stroke bg-panel px-[8px] py-[2px] font-pixel text-[12px] text-ink",
  "disabled:cursor-default disabled:opacity-50",
);

type Action = "bold" | "italic" | "h" | "ul" | "quote" | "code" | "link";

function apply(value: string, start: number, end: number, action: Action): { value: string; caret: number } {
  const sel = value.slice(start, end);
  const wrap = (l: string, r: string, ph: string) => {
    const inner = sel || ph;
    return { value: value.slice(0, start) + l + inner + r + value.slice(end), caret: start + l.length + inner.length };
  };
  const prefix = (p: string) => {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    return { value: value.slice(0, lineStart) + p + value.slice(lineStart), caret: end + p.length };
  };
  switch (action) {
    case "bold":
      return wrap("**", "**", "bold");
    case "italic":
      return wrap("*", "*", "italic");
    case "code":
      return sel.includes("\n") ? wrap("```\n", "\n```", "code") : wrap("`", "`", "code");
    case "link":
      return wrap("[", "](https://)", "text");
    case "h":
      return prefix("## ");
    case "ul":
      return prefix("- ");
    case "quote":
      return prefix("> ");
  }
}

const BUTTONS: [Action, string][] = [
  ["bold", "B"],
  ["italic", "I"],
  ["h", "H"],
  ["ul", "LIST"],
  ["quote", "QUOTE"],
  ["code", "</>"],
  ["link", "LINK"],
];

export function MdEditor({
  value,
  onChange,
  hours,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  hours: number;
  disabled?: boolean;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function act(a: Action) {
    const el = ta.current;
    if (!el) return;
    const r = apply(el.value, el.selectionStart, el.selectionEnd, a);
    onChange(r.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.caret, r.caret);
    });
  }

  async function attach(f: File) {
    setBusy(true);
    setErr(null);
    const r = await uploadImageFile(f);
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    const el = ta.current;
    const pos = el ? el.selectionEnd : value.length;
    const md = `![screenshot](${r.url})`;
    onChange(value.slice(0, pos) + (pos && value[pos - 1] !== "\n" ? "\n" : "") + md + "\n" + value.slice(pos));
  }

  const len = journalTextLength(value);
  const need = journalCharsNeeded(hours);
  const imgNeed = journalImagesNeeded(hours);
  const imgHave = countJournalImages(value);
  const ok = len >= need && imgHave >= imgNeed;

  return (
    <div>
      <div className="mb-[6px] flex flex-wrap gap-[4px]">
        {BUTTONS.map(([a, l]) => (
          <button key={a} type="button" className={mdBtn} disabled={disabled || preview} onClick={() => act(a)}>
            {l}
          </button>
        ))}
        <button type="button" className={mdBtn} disabled={disabled || busy} onClick={() => file.current?.click()}>
          {busy ? "UPLOADING..." : "IMAGE"}
        </button>
        <button type="button" className={cn(mdBtn, preview && "bg-ink text-panel-deep")} onClick={() => setPreview((p) => !p)}>
          PREVIEW
        </button>
      </div>
      {preview ? (
        <div className="min-h-[96px] border-2 border-stroke bg-panel-deep p-[10px]">{value.trim() ? <Markdown source={value} /> : <span className="text-faint">Nothing to preview.</span>}</div>
      ) : (
        <textarea
          ref={ta}
          className={cn(textareaField, "min-h-40")}
          maxLength={5000}
          value={value}
          disabled={disabled}
          placeholder="What did you build? Markdown supported: **bold**, # headings, - lists, links, code blocks. Paste an image to attach it."
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const f = clipboardImage(e);
            if (f) {
              e.preventDefault();
              void attach(f);
            }
          }}
        />
      )}
      <input
        ref={file}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void attach(f);
        }}
      />
      <span className={hint(ok ? "ok" : "bad")}>
        {need ? `${len} / ${need} chars` : `${len} chars`} · {imgHave} / {imgNeed} image{imgNeed === 1 ? "" : "s"}
      </span>
      {err ? <span className={hint("bad")}>{err}</span> : null}
    </div>
  );
}
