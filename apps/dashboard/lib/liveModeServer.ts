import { cookies } from "next/headers";
import { LIVE_MODE_COOKIE, isLiveModeValue } from "@/lib/liveMode";

export async function getLiveMode(): Promise<boolean> {
  return isLiveModeValue((await cookies()).get(LIVE_MODE_COOKIE)?.value);
}
