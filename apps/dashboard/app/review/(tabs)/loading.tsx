import { CardSkeleton } from "@/app/_components/Loading";

// Covers every /review/* tab except [id] (which has its own richer skeleton).
// Scoped under the layout, so only this content area swaps while the
// ReviewTabs bar above it stays mounted , see layout.tsx in this folder.
export default function Loading() {
  return (
    <div className="mt-4 space-y-3">
      <CardSkeleton lines={5} />
      <CardSkeleton lines={5} />
      <CardSkeleton lines={5} />
    </div>
  );
}
