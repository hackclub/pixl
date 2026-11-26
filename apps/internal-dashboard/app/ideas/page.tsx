import { requirePage } from "@/lib/guard";
import { listIdeas } from "@/lib/db";
import { IdeaBanForm, IdeaUnbanForm } from "@/app/_components/Moderate";
import {
  Badge,
  Card,
  EmptyRow,
  FilterBar,
  Flash,
  Muted,
  PageHeader,
  Table,
  TextLink,
  formatDate,
} from "@/app/_ui/ui";

export const dynamic = "force-dynamic";

export default async function IdeasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string }>;
}) {
  await requirePage("owner");
  const { q, error } = await searchParams;
  const ideas = await listIdeas(q);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ideas"
        count={ideas.length}
        description="The idea playground board. Posts go live instantly with no review step, so this is its moderation queue. Removing an idea hides it from players and notifies the poster, and it can be undone."
      />
      <Flash error={error} />

      <div>
        <FilterBar q={q} placeholder="Search by title" />

        <Card padding="flush">
          <Table headers={["Title", "Author", "Status", "Posted", ""]}>
            {ideas.map((idea) => (
              <tr key={idea.id}>
                <td className="max-w-80">
                  <div className="truncate font-bold">{idea.title}</div>
                  {idea.body && (
                    <div className="truncate text-xs">
                      <Muted>{idea.body}</Muted>
                    </div>
                  )}
                </td>
                <td>
                  <TextLink href={`/players/${idea.user_id}`} className="font-bold">
                    {idea.users?.real_name || idea.users?.display_name || idea.user_id}
                  </TextLink>
                </td>
                <td>
                  {idea.banned_at ? (
                    <div>
                      <Badge tone="danger">removed</Badge>
                      <div className="mt-1 max-w-56 truncate text-xs">
                        <Muted>
                          {idea.ban_by}: {idea.ban_reason}
                        </Muted>
                      </div>
                    </div>
                  ) : (
                    <Badge tone="success">live</Badge>
                  )}
                </td>
                <td className="text-sm">
                  <Muted>{formatDate(idea.created_at)}</Muted>
                </td>
                <td>{idea.banned_at ? <IdeaUnbanForm ideaId={idea.id} /> : <IdeaBanForm ideaId={idea.id} />}</td>
              </tr>
            ))}
            {ideas.length === 0 && (
              <EmptyRow colSpan={5} title={q ? "No ideas match that search" : "No ideas posted yet"} icon="lightbulb" />
            )}
          </Table>
        </Card>
      </div>
    </div>
  );
}
