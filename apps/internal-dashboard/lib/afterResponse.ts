import { after } from "next/server";

export async function afterResponse(job: () => Promise<unknown>, label: string): Promise<void> {
  const run = async () => {
    try {
      await job();
    } catch (e) {
      console.error(`[afterResponse] ${label} failed`, (e as Error).message);
    }
  };
  try {
    after(run);
  } catch {
    await run();
  }
}
