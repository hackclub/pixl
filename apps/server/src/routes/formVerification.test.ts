import { describe, expect, test } from "bun:test";
import { createVerificationStore } from "./formVerification.js";

// F-12: apps/server/src/routes/forms.ts's /submit endpoint used to accept a
// plain, client-typed slackId with no proof the submitter actually controls
// that Slack account (only that the id resolves to a real workspace member -
// a typo check, not an identity check). This proves the invariant the new
// DM-a-code flow (formVerification.ts) is supposed to hold: knowing someone's
// Slack id is not, on its own, enough to complete a submission as them.
describe("createVerificationStore (F-12 proof-of-ownership)", () => {
  test("a key with no code ever issued for it can't be verified by a guess", () => {
    const store = createVerificationStore();
    expect(store.verify("form:U_VICTIM", "000000")).toBe("expired_or_missing");
  });

  test("the correct code verifies successfully", () => {
    const store = createVerificationStore({ randomCode: () => "482913" });
    store.issue("form:U1", "Ada");
    expect(store.verify("form:U1", "482913")).toBe("ok");
  });

  test("a code is single use - verifying twice with the right code fails the second time", () => {
    const store = createVerificationStore({ randomCode: () => "111111" });
    store.issue("form:U1", "Ada");
    expect(store.verify("form:U1", "111111")).toBe("ok");
    expect(store.verify("form:U1", "111111")).toBe("expired_or_missing");
  });

  test("a wrong code is rejected without consuming the pending entry", () => {
    const store = createVerificationStore({ randomCode: () => "222222" });
    store.issue("form:U1", "Ada");
    expect(store.verify("form:U1", "000000")).toBe("wrong_code");
    // Still pending - the real code still works on the next attempt.
    expect(store.verify("form:U1", "222222")).toBe("ok");
  });

  test("verification attempts are capped - the code is discarded after too many wrong guesses", () => {
    const store = createVerificationStore({ randomCode: () => "999999", maxAttempts: 3 });
    store.issue("form:U1", "Ada");
    expect(store.verify("form:U1", "000000")).toBe("wrong_code");
    expect(store.verify("form:U1", "000000")).toBe("wrong_code");
    expect(store.verify("form:U1", "000000")).toBe("wrong_code");
    // Budget exhausted - even the real code no longer works, a fresh
    // request-code is required.
    expect(store.verify("form:U1", "999999")).toBe("too_many_attempts");
    expect(store.verify("form:U1", "999999")).toBe("expired_or_missing");
  });

  test("a code expires after its TTL", () => {
    let now = 1_000_000;
    const store = createVerificationStore({ randomCode: () => "555555", ttlMs: 10_000, now: () => now });
    store.issue("form:U1", "Ada");
    now += 10_001;
    expect(store.verify("form:U1", "555555")).toBe("expired_or_missing");
  });

  test("issuing again within the resend cooldown is a no-op (returns null, doesn't rotate the code)", () => {
    let now = 0;
    let calls = 0;
    const codes = ["111111", "222222"];
    const store = createVerificationStore({
      now: () => now,
      resendCooldownMs: 60_000,
      randomCode: () => codes[calls++],
    });
    expect(store.issue("form:U1", "Ada")).toBe("111111");
    now += 1_000;
    // Still within cooldown - no new code issued, and the original still verifies.
    expect(store.issue("form:U1", "Ada")).toBeNull();
    expect(store.verify("form:U1", "111111")).toBe("ok");
  });

  test("issuing again after the resend cooldown rotates to a new code, invalidating the old one", () => {
    let now = 0;
    let calls = 0;
    const codes = ["111111", "222222"];
    const store = createVerificationStore({
      now: () => now,
      resendCooldownMs: 60_000,
      randomCode: () => codes[calls++],
    });
    store.issue("form:U1", "Ada");
    now += 60_001;
    expect(store.issue("form:U1", "Ada")).toBe("222222");
    expect(store.verify("form:U1", "111111")).toBe("wrong_code");
    expect(store.verify("form:U1", "222222")).toBe("ok");
  });

  test("keys are scoped per form - a code issued for one form doesn't verify against another", () => {
    const store = createVerificationStore({ randomCode: () => "333333" });
    store.issue("formA:U1", "Ada");
    expect(store.verify("formB:U1", "333333")).toBe("expired_or_missing");
    expect(store.verify("formA:U1", "333333")).toBe("ok");
  });

  test("peekName returns the cached name while pending, and nothing once consumed", () => {
    const store = createVerificationStore({ randomCode: () => "444444" });
    store.issue("form:U1", "Ada Lovelace");
    expect(store.peekName("form:U1")).toBe("Ada Lovelace");
    store.verify("form:U1", "444444");
    expect(store.peekName("form:U1")).toBeNull();
  });
});
