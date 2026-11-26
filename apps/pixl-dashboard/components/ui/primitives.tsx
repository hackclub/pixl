// shadcn-style LEDGER primitives, all Tailwind. The class-string exports
// (panel, field, pageTitle, ...) are for elements that aren't one of the
// components below, e.g. a <Link> styled as a button: always combine them
// through cn() so twMerge settles any override. Small and dependency-free so
// server and client components can both use them.
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

const buttonBase = cva(
  [
    "inline-flex items-center gap-[7px] whitespace-nowrap rounded-none no-underline cursor-px",
    "border-2 border-r-4 border-b-4 border-stroke",
    "font-pixel text-[15px] font-semibold tracking-[.5px] px-[17px] py-[9px]",
    // Hover only changes the background: buttons never move or grow.
    "transition-[background-color,color] duration-[130ms]",
    "disabled:cursor-default disabled:opacity-45",
  ],
  {
    variants: {
      variant: {
        default: "bg-gold text-btn-ink hover:bg-gold-soft hover:text-btn-ink disabled:hover:bg-gold",
        dark: "bg-button-dark text-button-dark-ink hover:bg-[color-mix(in_srgb,var(--button-dark)_82%,#fff)] hover:text-button-dark-ink",
        ghost: "bg-transparent text-ink hover:bg-panel-2 hover:text-ink disabled:hover:bg-transparent",
        teal: "bg-teal text-btn-ink hover:bg-(--teal-hover) disabled:hover:bg-teal",
        red: "bg-bad text-panel-deep hover:bg-[color-mix(in_srgb,var(--bad)_85%,#fff)] disabled:hover:bg-bad",
      },
      size: { default: "", sm: "px-3 py-1 text-xs" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function buttonVariants(props?: VariantProps<typeof buttonBase>): string {
  return cn(buttonBase(props));
}

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonBase>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonBase({ variant, size }), className)} {...props} />;
});

// Square 32px icon button on the top rail (theme toggle, font toggle, ...).
export const railButton = cn(
  "inline-flex size-[32px] shrink-0 items-center justify-center rounded-none cursor-px",
  "border-2 border-r-4 border-b-4 border-stroke bg-panel text-ink",
  "font-pixel text-[15px] font-bold leading-none",
  "transition-[background-color,color] duration-[130ms] hover:bg-accent hover:text-panel-deep",
  "[&_svg]:size-[16px] [&_svg]:[image-rendering:pixelated]",
);

export const panel = "rounded-none border-2 border-stroke bg-panel shadow-drop";
export const panelDeep = "rounded-none border-2 border-stroke bg-panel-deep shadow-drop";

// Clickable lifted card.
export const card = cn(
  panel,
  "cursor-px transition-[box-shadow,transform,background-color] duration-[130ms]",
  "hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-drop-lg active:translate-none active:shadow-drop",
);

export const field = cn(
  "w-full rounded-none border-2 border-stroke bg-panel px-[14px] py-[10px] font-sans text-[15px] text-ink outline-none",
  "transition-[box-shadow,transform] duration-[130ms] placeholder:text-muted",
  "focus:-translate-x-px focus:-translate-y-px focus:shadow-drop",
);
export const textareaField = cn(field, "min-h-[96px] resize-y");
export const selectField = cn(field, "cursor-px");

export const label = "mb-[6px] block font-pixel text-[12px] uppercase tracking-[1.5px] text-dim";

export const pageTitle = "font-pixel text-[34px] font-bold leading-[1.05] tracking-[1px] text-ink";
export const pageSub = "mt-[8px] font-pixel text-[13px] font-medium uppercase tracking-[2px] text-dim";

// The shell's centred page column.
export const wrap = "mx-auto max-w-[1120px] px-[20px] pt-[26px] pb-[72px]";
// Auto-filling card grid (what the old global `.grid` class did).
export const autoGrid = "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[14px]";
export const emptyNote = "px-[20px] py-[40px] text-center font-pixel text-[16px] leading-[1.8] tracking-[1px] text-dim";
export const divider = "my-[30px] h-[2px] bg-stroke";

export const spinner =
  "mx-auto my-[40px] size-[30px] animate-spin-steps rounded-full border-4 border-panel-2 border-t-accent";
export const spinnerSm =
  "inline-block size-[12px] animate-spin-steps rounded-full border-2 border-panel-2 border-t-accent align-[-2px]";

export const dotVariants = cva("inline-block size-[9px] shrink-0 rounded-none border border-stroke", {
  variants: {
    tone: { none: "", on: "bg-good", off: "bg-bad", gold: "bg-gold", teal: "bg-teal" },
  },
  defaultVariants: { tone: "none" },
});

// Striped progress bar: <div className={rbar}><i className={rbarFill(tone)} style={{ width }} /></div>
export const rbar = "relative h-[16px] overflow-hidden rounded-none border-2 border-stroke bg-panel";
export function rbarFill(tone: "teal" | "gold" = "teal"): string {
  return cn(
    "block h-full transition-[width] duration-500",
    tone === "gold"
      ? "bg-[repeating-linear-gradient(90deg,var(--gold)_0_7px,var(--gold-soft)_7px_14px)]"
      : "bg-[repeating-linear-gradient(90deg,var(--teal)_0_7px,var(--teal-hover)_7px_14px)]",
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(panel, "p-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("font-pixel text-lg tracking-wide text-ink", className)} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(field, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(textareaField, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, ComponentProps<"select">>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(selectField, className)} {...props} />;
});

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn(label, className)} {...props} />;
}

const badgeBase = cva(
  [
    "inline-flex items-center gap-[5px] rounded-none border-2 border-stroke px-[9px] py-[4px]",
    "font-sans text-[12.5px] font-bold tracking-[.2px] tabular-nums",
  ],
  {
    variants: {
      tone: {
        default: "bg-panel text-ink",
        gold: "bg-gold text-btn-ink",
        teal: "bg-teal text-btn-ink",
        green: "bg-good text-ink",
        red: "bg-bad text-panel-deep",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export function badgeVariants(props?: VariantProps<typeof badgeBase>): string {
  return cn(badgeBase(props));
}

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeBase>) {
  return <span className={cn(badgeBase({ tone }), className)} {...props} />;
}

export function noticeClass(tone?: "bad" | "good"): string {
  return cn(
    "border-2 border-stroke bg-panel-2 px-[12px] py-[10px] text-[14px]",
    tone === "bad" && "bg-[color-mix(in_srgb,var(--bad)_18%,var(--panel))]",
    tone === "good" && "bg-[color-mix(in_srgb,var(--good)_18%,var(--panel))]",
  );
}

export function Notice({
  tone,
  className,
  ...props
}: ComponentProps<"div"> & { tone?: "bad" | "good" }) {
  return <div role={tone === "bad" ? "alert" : "status"} className={cn(noticeClass(tone), className)} {...props} />;
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className={pageTitle}>{title}</h1>
        {sub ? <p className={pageSub}>{sub}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className={emptyNote}>{children}</div>;
}
