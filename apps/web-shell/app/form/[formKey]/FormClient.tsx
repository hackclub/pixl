"use client";

import { useState } from "react";

const SLACK_ID_RE = /^[UW][A-Z0-9]{6,}$/;
const CODE_RE = /^\d{6}$/;

// Two-step flow: request-code proves the submitter actually controls the
// Slack account they typed (F-12) before /submit is ever called. Answers
// are filled in during "form" and carried through to the final /submit call
// once the code from "code" is entered - only one write of them either way.
type Step = "form" | "code" | "done";

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
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!SLACK_ID_RE.test(slackId.trim())) {
      setError("That doesn't look like a valid Slack member ID (starts with U or W).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formKey)}/request-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ slackId: slackId.trim() }),
      });
      // The response is intentionally the same whether or not that Slack ID
      // is real - it never tells us which happened.
      if (!res.ok) throw new Error("request failed");
      setStep("code");
      setNotice("If that's a real Slack member, we just sent them a 6-digit code. Enter it below.");
    } catch {
      setError("Something went wrong sending that code. Try again in a bit.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!CODE_RE.test(code.trim())) {
      setError("Enter the 6-digit code we sent you on Slack.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formKey)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ slackId: slackId.trim(), code: code.trim(), answers: values, website }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(
          json.error === "already_pending"
            ? "You've already got a submission pending review - hang tight, we'll DM you."
            : json.error === "invalid_code"
              ? "That code's wrong. Double check the DM we sent, or resend a new one."
              : json.error === "code_expired_or_missing"
                ? "That code's expired or was never requested for this Slack ID. Resend one below."
                : json.error === "too_many_attempts"
                  ? "Too many wrong codes - resend a new one below."
                  : "Something went wrong submitting that. Try again in a bit.",
        );
        return;
      }
      setStep("done");
    } catch {
      setError("Something went wrong submitting that. Try again in a bit.");
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <div style={{ background: "#efe", border: "1px solid #9c9", borderRadius: 8, padding: 16 }}>
        Thanks - your submission was received. We&apos;ll DM you on Slack once it&apos;s been
        looked at.
      </div>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={submit}>
        {notice && <p style={{ color: "#333", marginBottom: 12 }}>{notice}</p>}
        <label style={{ display: "block", marginBottom: 16 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            Verification code
          </span>
          <input
            required
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc", fontFamily: "inherit" }}
          />
        </label>
        {error && <p style={{ color: "#c00", marginBottom: 12 }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{
            background: "#4A154B",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            border: "none",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            marginRight: 12,
          }}
        >
          {busy ? "Submitting…" : "Verify & submit"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => requestCode(e)}
          style={{
            background: "none",
            color: "#4A154B",
            padding: "10px 4px",
            border: "none",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            textDecoration: "underline",
          }}
        >
          Resend code
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={requestCode}>
      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          Your Slack member ID
        </span>
        <span style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 6 }}>
          In Slack: click your profile photo → More → Copy member ID. It starts with U or W.
          We&apos;ll DM you a code there to confirm it&apos;s really you.
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
        disabled={busy}
        style={{
          background: "#4A154B",
          color: "#fff",
          padding: "10px 20px",
          borderRadius: 8,
          border: "none",
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Sending code…" : "Send verification code"}
      </button>
    </form>
  );
}
