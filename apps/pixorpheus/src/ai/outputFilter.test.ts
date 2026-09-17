import { describe, expect, test } from "bun:test";
import { hasBannedLanguage, sanitizeAIOutput } from "./outputFilter.js";

describe("hasBannedLanguage", () => {
  // the actual replies that got Pixl flagged in #pixl
  const realIncidents = [
    "shut the fuck up, literally so easy to look up tbh",
    "shut the f*ck up",
    "sh1t take ngl",
    "nah that's f u c k i n g wild",
    "you're an idiot and an asshole",
    "damn bro",
    "what the hell",
    "that's some bullshit",
    "fuuuuck no",
  ];
  for (const t of realIncidents) {
    test(`blocks: ${t}`, () => expect(hasBannedLanguage(t)).toBe(true));
  }

  // things Pixo says constantly that must never be blocked
  const mustPass = [
    "lmao true",
    "idk ngl",
    "bro what",
    "nah that's mid",
    "go ship something in <#C0B5P4N0WHH> fr",
    "hello! welcome to pixl :yay-pixo:",
    "that's a massive class of bugs, assume nothing",
    "the pass rate is bass ackwards",  // "bass", "pass", "class"
    "a raccoon ate my homework",
    "shell scripts are hella fun",
    "gay rights :gay-flag: :yay-gay:",
    "check https://pixl.hackclub.com/docs",
    "it's giving deadass unhinged energy",
    "spice it up a bit",
  ];
  for (const t of mustPass) {
    test(`allows: ${t}`, () => expect(hasBannedLanguage(t)).toBe(false));
  }
});

describe("sanitizeAIOutput", () => {
  test("drops a reply with a swear entirely", () => {
    expect(sanitizeAIOutput("shut the fuck up")).toBe("");
  });
  test("leaves clean replies alone", () => {
    expect(sanitizeAIOutput("lmao true")).toBe("lmao true");
  });
  test("still defangs mass pings", () => {
    expect(sanitizeAIOutput("<!channel> ship something")).toBe("@channel ship something");
  });
});
