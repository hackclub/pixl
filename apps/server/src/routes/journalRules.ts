// Journal content rules shared by the create/edit routes and their tests.
// The dashboard mirrors these in app/(shell)/projects/format.ts so its live
// hint matches what the server will accept.

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g;

// How many images a journal entry's content needs, by the hours logged: at
// least 1 always (even a 0h entry), plus one more per 4h on top of that.
export function journalImagesNeeded(hours: number): number {
  return Math.max(1, Math.ceil(hours / 4));
}

// Images are embedded as markdown image syntax (![alt](url)) by the
// dashboard's IMAGE toolbar button, this just counts how many are actually
// in the saved content.
export function countJournalImages(content: string): number {
  return (content.match(MARKDOWN_IMAGE_RE) ?? []).length;
}

// Characters that count toward the "100 per hour" writing minimum. Image
// embeds are evidence, not writing: their URLs are long, so attaching a
// screenshot must not stand in for journal text.
export function journalTextLength(content: string): number {
  return content.replace(MARKDOWN_IMAGE_RE, "").trim().length;
}
