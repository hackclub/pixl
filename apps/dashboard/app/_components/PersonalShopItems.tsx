import {
  createPersonalShopItem,
  setPersonalShopItemActive,
  deletePersonalShopItem,
} from "@/app/actions";
import type { PersonalShopItem } from "@/lib/db";
import { PendingButton } from "@/app/_components/PendingButton";
import { Disclosure } from "@/app/_components/Disclosure";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FILE_INPUT =
  "block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80";

function statusBadge(item: PersonalShopItem) {
  if (item.purchase)
    return (
      <Badge variant="info" title={`Order #${item.purchase.order_id}`}>
        bought ({item.purchase.status})
      </Badge>
    );
  return item.active ? (
    <Badge variant="success">live in their shop</Badge>
  ) : (
    <Badge variant="secondary">hidden</Badge>
  );
}

// Items made for one specific player: they only ever appear in that player's
// own shop (any region), can be bought once, and stay hidden until activated.
export function PersonalShopItems({
  items,
  error,
}: {
  items: PersonalShopItem[];
  error?: string;
}) {
  return (
    <Card className="p-5 md:p-6 gap-0">
      <div className="text-base font-semibold">Personal items</div>
      <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
        An item made for one player, for people whose region doesn&apos;t have what they need. It
        shows up in their normal shop (whatever region they are in) once you activate it, they can
        buy it once, and it leaves their shop after. Nobody else ever sees it and it isn&apos;t
        announced in Slack.
      </p>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Disclosure summary="Create a personal item" className="mt-4">
        <form action={createPersonalShopItem} className="grid gap-3 max-w-xl">
          <div className="grid gap-1.5">
            <Label htmlFor="pi-player">Player</Label>
            <Input
              id="pi-player"
              name="player"
              required
              placeholder="Slack ID (U0...) or exact in-game name"
              className="text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pi-name">Item name</Label>
            <Input id="pi-name" name="name" required maxLength={60} className="text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pi-desc">Description</Label>
            <Textarea id="pi-desc" name="description" rows={3} maxLength={300} className="text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pi-price">Price (pixels)</Label>
            <Input
              id="pi-price"
              name="price"
              type="number"
              min={1}
              step={1}
              required
              className="text-sm w-40"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pi-options">Options (optional)</Label>
            <Input
              id="pi-options"
              name="options"
              placeholder="Color: Black, White"
              className="text-sm"
            />
            <span className="text-xs text-muted-foreground">
              Same format as the other items, a name, a colon, then comma separated choices.
            </span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pi-image">Image (optional)</Label>
            <input id="pi-image" name="image" type="file" accept="image/*" className={FILE_INPUT} />
          </div>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <input type="checkbox" name="activate" value="1" />
            Activate right away (otherwise it stays hidden until you press Activate)
          </Label>
          <div>
            <PendingButton pendingText="Creating…">Create item</PendingButton>
          </div>
        </form>
      </Disclosure>

      <div className="mt-5">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No personal items yet.</div>
        ) : (
          <div className="grid gap-3">
            {items.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border border-border p-3 flex flex-wrap items-center gap-3 ${
                  item.active || item.purchase ? "" : "opacity-70"
                }`}
              >
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-12 h-12 rounded-md object-cover border border-border shrink-0 [image-rendering:pixelated]"
                  />
                ) : (
                  <span className="grid place-items-center w-12 h-12 rounded-md bg-muted border border-border shrink-0">
                    🎁
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{item.name}</span>
                    <Badge variant="success" className="tabular-nums">
                      {item.price} px
                    </Badge>
                    {statusBadge(item)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    For {item.owner?.display_name ?? "unknown player"}
                    {item.owner?.slack_id ? ` (${item.owner.slack_id})` : ""}
                    {item.description ? ` · ${item.description}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!item.purchase && (
                    <form action={setPersonalShopItemActive}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="active" value={item.active ? "0" : "1"} />
                      <PendingButton
                        variant="outline"
                        size="sm"
                        pendingText={item.active ? "Hiding…" : "Activating…"}
                      >
                        {item.active ? "Hide" : "Activate"}
                      </PendingButton>
                    </form>
                  )}
                  {!item.purchase && (
                    <form action={deletePersonalShopItem}>
                      <input type="hidden" name="id" value={item.id} />
                      <PendingButton
                        variant="outline"
                        size="sm"
                        pendingText="Deleting…"
                        confirm={`Delete "${item.name}"?`}
                      >
                        Delete
                      </PendingButton>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
