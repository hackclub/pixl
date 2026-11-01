import { describe, expect, test } from "bun:test";
import {
  builderDetailsView,
  canReadReviewEvidence,
  canSeeBuilderPII,
  builderNameFor,
  canSetHold,
  isOwnOrCollaborator,
  proposedBanDecision,
  queueAllows,
  redactBuilderUser,
  slackIdFromActorName,
  type ReviewViewer,
} from "./reviewAccess";

const viewer = (over: Partial<ReviewViewer> = {}): ReviewViewer => ({
  isOwner: false,
  canSecondPass: false,
  reviewQueues: "both",
  session: { slackId: "UREV" },
  ...over,
});

describe("M1: decisions on a first-pass ban proposal", () => {
  const opts = { own: false, proposedBy: "Alice (UALICE)", actor: "Rev (UREV)" };

  test("a non-owner final reviewer can't confirm a ban (owner-only)", () => {
    const d = proposedBanDecision(viewer({ canSecondPass: true }), "ban", opts);
    expect(d.kind).toBe("deny");
  });

  test("a non-owner final reviewer's approve is rerouted into the pipeline, never final", () => {
    const d = proposedBanDecision(viewer({ canSecondPass: true }), "approved", opts);
    expect(d.kind).toBe("reroute_to_pipeline");
  });

  test("an owner's verdict is final (ban or approve)", () => {
    expect(proposedBanDecision(viewer({ isOwner: true, canSecondPass: true }), "ban", opts).kind).toBe("final");
    expect(proposedBanDecision(viewer({ isOwner: true }), "approved", opts).kind).toBe("final");
  });

  test("request changes still bounces to the maker", () => {
    expect(proposedBanDecision(viewer({ canSecondPass: true }), "needs_changes", opts).kind).toBe("needs_changes");
  });

  test("no second-pass access -> denied", () => {
    expect(proposedBanDecision(viewer(), "approved", opts).kind).toBe("deny");
  });

  test("the proposer can't confirm/overturn their own proposal (non-owner)", () => {
    const d = proposedBanDecision(viewer({ canSecondPass: true }), "approved", { ...opts, actor: opts.proposedBy });
    expect(d.kind).toBe("deny");
  });

  test("the proposer is matched by Slack id, not the display-name label", () => {
    const d = proposedBanDecision(viewer({ canSecondPass: true }), "approved", {
      ...opts,
      proposedBy: "Rev Old Name (UREV)",
      actor: "Rev (UREV)",
    });
    expect(d.kind).toBe("deny");
    // A label with no parseable Slack id can't prove it's someone else.
    expect(proposedBanDecision(viewer({ canSecondPass: true }), "approved", { ...opts, proposedBy: "Alice" }).kind).toBe(
      "deny",
    );
    expect(slackIdFromActorName("A (B) Name (U123)")).toBe("U123");
    expect(slackIdFromActorName(null)).toBe("");
  });

  test("own or collaborator project is refused for everyone, owners included", () => {
    for (const v of [viewer({ canSecondPass: true }), viewer({ isOwner: true, canSecondPass: true })])
      for (const verdict of ["approved", "ban", "needs_changes"])
        expect(proposedBanDecision(v, verdict, { ...opts, own: true }).kind).toBe("deny");
  });
});

describe("M2: self-review covers accepted collaborators", () => {
  test("owner match", () => {
    expect(isOwnOrCollaborator(["u1"], "u1", [])).toBe(true);
  });
  test("accepted collaborator match", () => {
    expect(isOwnOrCollaborator(["u9", "u2"], "owner", ["u3", "u2"])).toBe(true);
  });
  test("unrelated reviewer", () => {
    expect(isOwnOrCollaborator(["u5"], "owner", ["u3"])).toBe(false);
  });
  test("a pending collaborator invite counts (the caller passes pending + accepted ids)", () => {
    expect(isOwnOrCollaborator(["u7"], "owner", ["u7"])).toBe(true);
  });
  test("a reviewer with no users row is never 'own' (and empty ids never match)", () => {
    expect(isOwnOrCollaborator([], "owner", ["owner"])).toBe(false);
    expect(isOwnOrCollaborator([""], "", [""])).toBe(false);
  });
});

describe("builder names: legal name for owners/final reviewers only", () => {
  const user = { real_name: "Jane Legal Doe", display_name: "janey", slack_id: "UJANE" };
  const firstPass = { isOwner: false, canSecondPass: false };

  test("a first-pass reviewer never gets real_name, whatever the row carries", () => {
    const name = builderNameFor(firstPass, user, { handle: "@jane" });
    expect(name).toBe("@jane");
    expect(name).not.toContain("Legal");
    expect(builderNameFor(firstPass, user)).toBe("janey");
    expect(builderNameFor(firstPass, { real_name: "Jane Legal Doe" }, { fallback: "uid-1" })).toBe("uid-1");
  });

  test("owners and final reviewers get the legal name first", () => {
    for (const who of [{ isOwner: true, canSecondPass: false }, { isOwner: false, canSecondPass: true }])
      expect(builderNameFor(who, user, { handle: "@jane" })).toBe("Jane Legal Doe");
  });

  test("redactBuilderUser strips real_name from the payload for first-pass reviewers only", () => {
    const stripped = redactBuilderUser(firstPass, user);
    expect(stripped && "real_name" in stripped).toBe(false);
    expect(stripped?.display_name).toBe("janey");
    expect(redactBuilderUser({ isOwner: true, canSecondPass: false }, user)?.real_name).toBe("Jane Legal Doe");
    expect(redactBuilderUser(firstPass, null)).toBeNull();
  });
});

describe("M2: review queue scope is enforced on actions", () => {
  test("restricted reviewers only reach their kind", () => {
    expect(queueAllows("both", "hardware")).toBe(true);
    expect(queueAllows("hardware", "hardware")).toBe(true);
    expect(queueAllows("hardware", "software")).toBe(false);
    expect(queueAllows("software", "hardware")).toBe(false);
    expect(queueAllows("software", null)).toBe(false);
  });
});

describe("holds: no overwriting another reviewer's hold", () => {
  const me = { isOwner: false, session: { slackId: "UME" } };
  test("free or mine -> allowed", () => {
    expect(canSetHold({ held: false, holderSlackId: "" }, me)).toBe(true);
    expect(canSetHold({ held: true, holderSlackId: "UME" }, me)).toBe(true);
  });
  test("someone else's, or an unidentifiable setter -> refused for non-owners", () => {
    expect(canSetHold({ held: true, holderSlackId: "UOTHER" }, me)).toBe(false);
    expect(canSetHold({ held: true, holderSlackId: "" }, me)).toBe(false);
  });
  test("owners may", () => {
    expect(canSetHold({ held: true, holderSlackId: "UOTHER" }, { ...me, isOwner: true })).toBe(true);
  });
});

describe("H3: builder PII on the review page", () => {
  const raw = {
    fullName: "Jane Q Doe",
    email: "jane@example.com",
    birthday: "2010-04-05",
    age: 16,
    country: "Canada",
    address: "1 Main St, Toronto, ON, M1M 1M1, Canada",
  };

  test("a first-pass reviewer at second_review gets age + presence only", () => {
    const v = builderDetailsView({ isOwner: false, canSecondPass: false }, true, raw);
    expect(v.privileged).toBe(false);
    expect(v.ageLabel).toBe("16");
    expect(v.address).toBeNull();
    const shown = JSON.stringify(v);
    for (const secret of ["Jane", "jane@", "2010-04-05", "Main St", "Canada"]) expect(shown).not.toContain(secret);
    expect(v.fullName).toBe("on file");
  });

  test("missing fields read as missing", () => {
    const v = builderDetailsView({ isOwner: false, canSecondPass: false }, false, {
      ...raw,
      email: "",
      fullName: "",
      age: null,
    });
    expect(v.email).toBe("missing");
    expect(v.fullName).toBe("missing");
    expect(v.ageLabel).toBe("-");
  });

  test("final reviewers and owners see birth date + address at second_review", () => {
    for (const who of [{ isOwner: false, canSecondPass: true }, { isOwner: true, canSecondPass: false }]) {
      expect(canSeeBuilderPII(who)).toBe(true);
      const v = builderDetailsView(who, true, raw);
      expect(v.ageLabel).toBe("16 (born 2010-04-05)");
      expect(v.address).toBe(raw.address);
      expect(v.email).toBe(raw.email);
    }
  });

  test("before second_review even privileged viewers get no address or birth date", () => {
    const v = builderDetailsView({ isOwner: true, canSecondPass: true }, false, raw);
    expect(v.address).toBeNull();
    expect(v.ageLabel).toBe("16");
  });
});


describe("review evidence and search scope", () => {
  test("a hardware-only reviewer cannot read software repository evidence", () => {
    expect(canReadReviewEvidence({ reviewQueues: "hardware", canFraudReview: false }, { kind: "software", status: "shipped" })).toBe(false);
    expect(canReadReviewEvidence({ reviewQueues: "hardware", canFraudReview: false }, { kind: "hardware", status: "shipped" })).toBe(true);
  });
  test("ordinary reviewers cannot see fraud review or second pass", () => {
    for (const status of ["fraud_review", "second_review"])
      expect(canReadReviewEvidence({ reviewQueues: "both", canFraudReview: false }, { kind: "software", status })).toBe(false);
  });
  test("authorized final reviewers retain access to their assigned queue", () => {
    for (const status of ["fraud_review", "second_review"])
      expect(canReadReviewEvidence({ reviewQueues: "software", canFraudReview: true }, { kind: "software", status })).toBe(true);
  });
});
