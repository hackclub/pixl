import { setLiveMode } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";

export function LiveModeToggle({ live }: { live: boolean }) {
  return (
    <form action={setLiveMode} className="flex items-center gap-2">
      <input type="hidden" name="on" value={live ? "0" : "1"} />
      {live && <span className="text-xs font-semibold text-red-600 dark:text-red-400">● LIVE · PII hidden</span>}
      <PendingButton variant={live ? "default" : "secondary"} size="sm" pendingText="Switching…">
        {live ? "Turn off live mode" : "Live mode"}
      </PendingButton>
    </form>
  );
}
