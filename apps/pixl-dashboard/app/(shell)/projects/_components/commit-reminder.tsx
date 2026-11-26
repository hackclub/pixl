import { Notice } from "@/components/ui/primitives";

// Reviewers verify hours against the repo's commit history, and a player can't
// add commits to a project after it shipped, so the reminder sits where they
// plan and ship, not only in the approval note.
export function CommitReminder({ className }: { className?: string }) {
  return (
    <Notice className={className}>
      <strong>Commit often.</strong> Reviewers check your commit history to verify your hours. Projects with few
      commits are hard to verify and can have their hours deflated.
    </Notice>
  );
}
