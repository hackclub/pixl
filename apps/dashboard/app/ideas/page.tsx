import Link from "next/link";
import { requirePagePerm } from "@/lib/guard";
import { getLiveMode } from "@/lib/liveModeServer";
import { liveName } from "@/lib/liveMode";
import { listIdeas } from "@/lib/db";
import { IdeaBanForm, IdeaUnbanForm } from "@/app/_components/Moderate";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  await requirePagePerm(["ideas"]);
  const live = await getLiveMode();
  const { q, error } = await searchParams;
  const ideas = await listIdeas(q);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-1">
        Ideas
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        The idea playground board , posts go live instantly with no review
        step, so this is the moderation queue for it. Removing an idea hides
        it from players and notifies the poster; reversible.
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form className="mb-5 flex gap-2">
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by title…"
          className="max-w-xs"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <Card className="overflow-hidden py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="p-3">Title</TableHead>
                <TableHead className="p-3">Author</TableHead>
                <TableHead className="p-3">Status</TableHead>
                <TableHead className="p-3">Posted</TableHead>
                <TableHead className="p-3"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ideas.map((idea) => (
                <TableRow key={idea.id}>
                  <TableCell className="p-3 max-w-80">
                    <div className="font-medium truncate">{idea.title}</div>
                    {idea.body && (
                      <div className="text-xs text-muted-foreground truncate">
                        {idea.body}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="p-3">
                    <Link
                      href={`/players/${idea.user_id}`}
                      className="font-bold hover:text-brand"
                    >
                      {liveName(live, idea.users, idea.users?.real_name || idea.users?.display_name || idea.user_id)}
                    </Link>
                  </TableCell>
                  <TableCell className="p-3">
                    {idea.banned_at ? (
                      <div>
                        <Badge variant="destructive">removed</Badge>
                        <div className="text-xs text-muted-foreground mt-1 max-w-56 truncate">
                          {idea.ban_by}: {idea.ban_reason}
                        </div>
                      </div>
                    ) : (
                      <Badge variant="success">live</Badge>
                    )}
                  </TableCell>
                  <TableCell className="p-3 text-muted-foreground">
                    {new Date(idea.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="p-3">
                    {idea.banned_at ? (
                      <IdeaUnbanForm ideaId={idea.id} />
                    ) : (
                      <IdeaBanForm ideaId={idea.id} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {ideas.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="p-5 text-muted-foreground" colSpan={5}>
                    No ideas posted yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
