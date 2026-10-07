import { setShowReviewerNames } from "@/app/actions";
import { PendingButton } from "@/app/_components/PendingButton";

// Only rendered while live: reveals other reviewers' names (hidden by default
// on stream), or hides them again.
export function ShowReviewerNames({ hidden }: { hidden: boolean }) {
  return (
    <form action={setShowReviewerNames}>
      <input type="hidden" name="show" value={hidden ? "1" : "0"} />
      <PendingButton variant="outline" size="sm" pendingText="Switching…">
        {hidden ? "Show reviewer names" : "Hide reviewer names"}
      </PendingButton>
    </form>
  );
}
