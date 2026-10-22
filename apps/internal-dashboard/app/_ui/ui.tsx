/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from "react";
import HcIcon, { type GlyphName } from "@hackclub/icons";
import SubmitButton from "./SubmitButton";
import { glyphStyle } from "./glyphs";
import { pageWindow } from "@/lib/pagination";

// The dashboard's whole UI kit. Every page builds from these, styled by
// admin.css (the hc-* classes). Ported from the Wonders admin.

export type { GlyphName };

export type Tone = "neutral" | "info" | "cyan" | "warning" | "yellow" | "success" | "danger" | "purple";

export type ButtonVariant = "primary" | "cream" | "outline" | "ghost" | "success" | "danger";

export type ButtonSize = "sm" | "md" | "lg";

export const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "hc-btn",
  cream: "hc-btn hc-btn-cream",
  outline: "hc-btn hc-btn-outline",
  ghost: "hc-btn hc-btn-ghost",
  success: "hc-btn hc-btn-success",
  danger: "hc-btn hc-btn-danger",
};

export const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "hc-btn-sm",
  md: "",
  lg: "hc-btn-lg",
};

export const BUTTON_ICON_SIZE: Record<ButtonSize, number> = {
  sm: 18,
  md: 20,
  lg: 22,
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return `${BUTTON_VARIANT_CLASS[variant]} ${BUTTON_SIZE_CLASS[size]}`.trim();
}

// Project statuses (projects.status) and shop order statuses (shop_orders.status).
// "shipped" is a project waiting on its first review, not a finished one.
export const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  shipped: "warning",
  fraud_review: "info",
  second_review: "cyan",
  approved: "success",
  needs_changes: "danger",
  pending: "warning",
  ordered: "info",
  credited: "purple",
  done: "success",
  cancelled: "neutral",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  shipped: "In review",
  fraud_review: "Fraud review",
  second_review: "Final review",
  approved: "Approved",
  needs_changes: "Needs changes",
  pending: "Pending",
  ordered: "Ordered",
  credited: "Credited",
  done: "Done",
  cancelled: "Cancelled",
};

export function Icon({
  glyph,
  size = 20,
  className = "",
}: {
  glyph: GlyphName;
  size?: number;
  className?: string;
}) {
  return <HcIcon glyph={glyph} size={size} className={className} style={glyphStyle(glyph)} aria-hidden />;
}

export function Badge({
  children,
  tone = "neutral",
  icon,
  outline = false,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: GlyphName;
  outline?: boolean;
}) {
  return (
    <span className="hc-badge" data-tone={tone} data-variant={outline ? "outline" : undefined}>
      {icon && <Icon glyph={icon} size={16} />}
      {children}
    </span>
  );
}

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <span className="hc-badge" data-variant="count">
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function Card({
  children,
  padding = "normal",
  sunken = false,
  className = "",
}: {
  children: ReactNode;
  padding?: "normal" | "compact" | "flush";
  sunken?: boolean;
  className?: string;
}) {
  return (
    <div className={`hc-card ${className}`} data-density={padding} data-variant={sunken ? "sunken" : undefined}>
      {children}
    </div>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="hc-card" data-variant="interactive" data-density="compact">
      {children}
    </Link>
  );
}

export function CardHeader({
  title,
  icon,
  count,
  action,
}: {
  title: ReactNode;
  icon?: GlyphName;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="hc-card-header">
      <h2 className="hc-heading flex items-center gap-2 text-base">
        {icon && <Icon glyph={icon} size={22} className="hc-muted" />}
        {title}
        {count !== undefined && <CountBadge>{count}</CountBadge>}
      </h2>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  count,
  description,
  actions,
}: {
  title: ReactNode;
  count?: number;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="hc-title flex flex-wrap items-center gap-3">
          {title}
          {count !== undefined && <CountBadge>{count}</CountBadge>}
        </h1>
        {description && <p className="hc-caption mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: GlyphName;
}) {
  return (
    <button className={`${buttonClass(variant, size)} ${className}`} {...props}>
      {icon && <Icon glyph={icon} size={BUTTON_ICON_SIZE[size]} />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  external = false,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: GlyphName;
  external?: boolean;
  children: ReactNode;
}) {
  const className = buttonClass(variant, size);

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {icon && <Icon glyph={icon} size={BUTTON_ICON_SIZE[size]} />}
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {icon && <Icon glyph={icon} size={BUTTON_ICON_SIZE[size]} />}
      {children}
    </Link>
  );
}

// Submit button for a <form action={serverAction}>. Disables itself while the
// action runs so a double click can't fire it twice; `confirm` asks first.
export function ActionButton({
  children,
  pendingLabel = "Working...",
  variant = "primary",
  size = "md",
  icon,
  disabled = false,
  confirm,
  formAction,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: GlyphName;
  disabled?: boolean;
  confirm?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  return (
    <SubmitButton
      pendingLabel={pendingLabel}
      className={buttonClass(variant, size)}
      disabled={disabled}
      confirm={confirm}
      formAction={formAction}
      name={name}
      value={value}
    >
      {icon && <Icon glyph={icon} size={BUTTON_ICON_SIZE[size]} />}
      {children}
    </SubmitButton>
  );
}

export function TextLink({
  href,
  children,
  external = false,
  className = "",
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
  className?: string;
}) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`hc-link ${className}`}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={`hc-link ${className}`}>
      {children}
    </Link>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="hc-mono">{children}</span>;
}

export function Muted({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`hc-muted ${className}`}>{children}</span>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="hc-code">{children}</code>;
}

export function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="hc-quote">{children}</blockquote>;
}

export function Callout({
  children,
  tone = "warning",
  icon,
}: {
  children: ReactNode;
  tone?: "warning" | "danger" | "info" | "success" | "neutral";
  icon?: GlyphName;
}) {
  return (
    <div className="hc-callout flex items-start gap-2" data-tone={tone}>
      {icon && <Icon glyph={icon} size={22} className="shrink-0" />}
      <div className="min-w-0 pt-px">{children}</div>
    </div>
  );
}

// The ?error= / ?ok= messages server actions redirect back with.
export function Flash({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (!error && !ok) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {error && (
        <Callout tone="danger" icon="important">
          {error}
        </Callout>
      )}
      {ok && (
        <Callout tone="success" icon="checkmark">
          {ok}
        </Callout>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon = "relaxed",
}: {
  title: ReactNode;
  children?: ReactNode;
  icon?: GlyphName;
}) {
  return (
    <div className="hc-empty">
      <span className="hc-empty-icon">
        <Icon glyph={icon} size={32} />
      </span>
      <p className="hc-empty-title">{title}</p>
      {children && <p className="hc-empty-body">{children}</p>}
    </div>
  );
}

export function Avatar({ src, size = 32 }: { src: string | null | undefined; size?: number }) {
  if (!src) {
    return (
      <span
        className="hc-avatar hc-muted inline-flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <Icon glyph="person" size={Math.round(size * 0.7)} />
      </span>
    );
  }

  return <img src={src} alt="" width={size} height={size} className="hc-avatar" />;
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <dl className="hc-stat-grid">{children}</dl>;
}

export function Stat({
  label,
  value,
  icon,
  tone,
  href,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: GlyphName;
  tone?: Tone;
  href?: string;
  hint?: ReactNode;
}) {
  const body = (
    <div className="hc-stat flex flex-col gap-3" data-tone={tone}>
      <dt className="hc-eyebrow flex items-center gap-1">
        {icon && <Icon glyph={icon} size={18} />}
        {label}
      </dt>
      <dd className="hc-stat-value m-0">{value}</dd>
      {hint && <dd className="hc-caption m-0 text-xs">{hint}</dd>}
    </div>
  );
  if (!href) {
    return (
      <div className="hc-card" data-density="compact">
        {body}
      </div>
    );
  }
  return <CardLink href={href}>{body}</CardLink>;
}

export function Table({
  headers,
  children,
  className = "",
}: {
  headers: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`hc-table-wrap ${className}`}>
      <table className="hc-table">
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({
  colSpan,
  title,
  children,
  icon,
}: {
  colSpan: number;
  title: ReactNode;
  children?: ReactNode;
  icon?: GlyphName;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState title={title} icon={icon}>
          {children}
        </EmptyState>
      </td>
    </tr>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`hc-label ${className}`}>
      {label}
      {hint && <span className="hc-label-hint">{hint}</span>}
      {children}
    </label>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`hc-input ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea className={`hc-textarea ${className}`} {...props} />;
}

// Plain <select> styled like the kit. Use this inside server-rendered forms;
// ./Select is the fancier client dropdown.
export function NativeSelect({ className = "", ...props }: ComponentPropsWithoutRef<"select">) {
  return <select className={`hc-native-select ${className}`} {...props} />;
}

export function Checkbox({
  label,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"input"> & { label: ReactNode }) {
  return (
    <label className={`hc-check ${className}`}>
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function FilterBar({
  q,
  placeholder,
  children,
}: {
  q?: string;
  placeholder: string;
  children?: ReactNode;
}) {
  return (
    <form className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-60 flex-1">
        <Icon
          glyph="search"
          size={20}
          className="hc-muted pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
        />
        <Input name="q" type="search" defaultValue={q} placeholder={placeholder} className="hc-input-search" />
      </div>
      {children}
      <Button type="submit" variant="outline">
        Filter
      </Button>
    </form>
  );
}

export function DescriptionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="hc-dl">
      {items.map(([label, value], i) => (
        <div key={i} className="contents">
          <dt>{label}</dt>
          <dd>{value === null || value === undefined || value === "" ? <Muted>-</Muted> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Details({
  summary,
  children,
  open = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="hc-details" open={open}>
      <summary>{summary}</summary>
      <div className="hc-details-body">{children}</div>
    </details>
  );
}

export interface TimelineEntry {
  key: string | number;
  title: ReactNode;
  meta?: ReactNode;
  body?: ReactNode;
}

export function Timeline({ entries, empty = "Nothing yet" }: { entries: TimelineEntry[]; empty?: ReactNode }) {
  if (entries.length === 0) {
    return <EmptyState title={empty} icon="history" />;
  }

  return (
    <ol className="hc-timeline">
      {entries.map((entry) => (
        <li key={entry.key}>
          <div className="flex flex-wrap items-center gap-2">{entry.title}</div>
          {entry.meta && <p className="hc-caption mt-1 text-xs">{entry.meta}</p>}
          {entry.body && <div className="mt-1">{entry.body}</div>}
        </li>
      ))}
    </ol>
  );
}

// Link-based tabs for server pages (?tab=...). The client ./Tabs switches
// panels without a navigation.
export function LinkTabs({
  tabs,
  active,
}: {
  tabs: { key: string; href: string; label: ReactNode; count?: number }[];
  active: string;
}) {
  return (
    <div className="hc-tabs" role="tablist">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className="hc-tab gap-2"
          role="tab"
          aria-selected={tab.key === active}
        >
          {tab.label}
          {tab.count !== undefined && <CountBadge>{tab.count}</CountBadge>}
        </Link>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
      <span className="hc-caption text-sm">
        Page {page} of {totalPages}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {page > 1 && (
          <>
            <ButtonLink href={hrefFor(1)} variant="outline" size="sm">
              First
            </ButtonLink>
            <ButtonLink href={hrefFor(page - 1)} variant="outline" size="sm">
              Previous
            </ButtonLink>
          </>
        )}
        {pageWindow(page, totalPages).map((item, i) =>
          item === "gap" ? (
            <span key={`gap-${i}`} className="hc-caption px-1 text-sm" aria-hidden="true">
              ...
            </span>
          ) : item === page ? (
            <span key={item} className={buttonClass("primary", "sm")} aria-current="page">
              {item}
            </span>
          ) : (
            <ButtonLink key={item} href={hrefFor(item)} variant="outline" size="sm">
              {String(item)}
            </ButtonLink>
          ),
        )}
        {page < totalPages && (
          <>
            <ButtonLink href={hrefFor(page + 1)} variant="outline" size="sm">
              Next
            </ButtonLink>
            <ButtonLink href={hrefFor(totalPages)} variant="outline" size="sm">
              Last
            </ButtonLink>
          </>
        )}
      </div>
    </nav>
  );
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }) + " UTC";
}
