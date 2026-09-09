"use client";

import { useState } from "react";

const SLACK_ID_RE = /^[UW][A-Z0-9]{6,}$/;

export function FormClient({
  formKey,
  questions,
}: {
  formKey: string;
  questions: { key: string; label: string }[];
}) {
  const [slackId, setSlackId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState(""); // honeypot - real users never see/fill this
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!SLACK_ID_RE.test(slackId.trim())) {
      setError("That doesn't look like a valid Slack member ID (starts with U or W).");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formKey)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ slackId: slackId.trim(), answers: values, website }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(
          json.error === "already_pending"
            ? "You've already got a submission pending review - hang tight, we'll DM you."
            : json.error === "slack_id_not_found"
              ? "We couldn't find that Slack member ID in the workspace - double check it."
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
        Thanks - your submission was received. We&apos;ll DM you on Slack once it&apos;s been
        looked at.
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          Your Slack member ID
        </span>
        <span style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}>
          In Slack: click your profile photo → More → Copy member ID. It starts with U or W.
        </span>
        <input
          required
          type="text"
          value={slackId}
          onChange={(e) => setSlackId(e.target.value)}
          placeholder="U0XXXXXXX"
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc", fontFamily: "inherit" }}
        />
      </label>
      {questions.map((f) => (
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
