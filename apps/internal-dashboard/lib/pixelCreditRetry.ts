/**
 * A project credit RPC is idempotent: it sets the project's net credited total
 * by applying only the difference. Retry transient database errors rather
 * than silently accepting an unpaid project.
 */
export async function retryProjectPixelCredit(
  credit: () => Promise<{ error: { message: string } | null }>,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  let lastError = "Unknown database error";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { error } = await credit();
      if (!error) return;
      lastError = error.message;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < 2) await wait(100 * (attempt + 1));
  }
  throw new Error(`Unable to credit project pixels after 3 attempts: ${lastError}`);
}
