"use client";

import { useState } from "react";

// Placeholder field list - swap this for the real questions once decided.
// Each entry becomes one <textarea>; the key is what shows up in the
// dashboard's Forms tab and in form_submissions.answers.
const FIELDS: { key: string; label: string }[] = [
  { key: "message", label: "Why do you want to help review projects?" },
];

export function FormClient({ formKey, name }: { formKey: string; name: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState(""); // honeypot - real users never see/fill this
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formKey)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ answers: values, website }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(
          json.error === "already_pending"
            ? "You've already got a submission pending review - hang tight, we'll DM you."
            : "Something went wrong submitting that. Try again in a bit.",
        );
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Something went wrong submitting that. Try again in a bit.");
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div style={{ background: "#efe", border: "1px solid #9c9", borderRadius: 8, padding: 16 }}>
        Thanks{name ? `, ${name}` : ""} - your submission was received. We&apos;ll DM you on Slack
        once it&apos;s been looked at.
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      {name && <p style={{ color: "#666", marginBottom: 16 }}>Signed in as {name}.</p>}
      {FIELDS.map((f) => (
        <label key={f.key} style={{ display: "block", marginBottom: 16 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            {f.label}
          </span>
          <textarea
            required
            rows={4}
            maxLength={4000}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc", fontFamily: "inherit" }}
          />
        </label>
      ))}
      {/* Honeypot - hidden from real users via CSS + off-screen positioning
          (not display:none, some bots skip those), tabIndex/autoComplete off
          so it's never reachable or suggested to a real visitor. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />
      {error && <p style={{ color: "#c00", marginBottom: 12 }}>{error}</p>}
      <button
        type="submit"
        disabled={status === "submitting"}
        style={{
          background: "#4A154B",
          color: "#fff",
          padding: "10px 20px",
          borderRadius: 8,
          border: "none",
          fontWeight: 600,
          cursor: status === "submitting" ? "default" : "pointer",
          opacity: status === "submitting" ? 0.6 : 1,
        }}
      >
        {status === "submitting" ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}
