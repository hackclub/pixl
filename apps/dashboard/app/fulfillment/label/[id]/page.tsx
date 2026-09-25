import { notFound } from "next/navigation";
import { requireFulfiller } from "@/lib/guard";
import { getShopOrder, buyerDetailsByUserId } from "@/lib/db";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

// A physical shipping label for orders that just get mailed in an envelope
// (no carrier tracking of their own), sized to a quarter of an A4 sheet
// (105mm x 148.5mm - same as ISO A6) and pinned to the sheet's top-right
// quadrant so the printout lines up with a quarter-cut label sheet, or can
// just be cut out by hand.
export default async function ShippingLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireFulfiller();
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isFinite(orderId)) notFound();
  const order = await getShopOrder(orderId);
  if (!order) notFound();
  const buyer = (await buyerDetailsByUserId([order.user_id])).get(order.user_id);
  const addressLines = buyer?.addressLines ?? [];

  return (
    <>
      <PrintButton />
      <div className="sheet">
        <div className="label">
          <img src="/label/pixl-wordmark.png" alt="Pixl" className="wordmark" />
          <div className="address-block">
            <div className="ship-to">Ship to</div>
            <div className="name">{buyer?.name || order.player_name || "(name missing)"}</div>
            {addressLines.length > 0 ? (
              addressLines.map((line, i) => (
                <div className="line" key={i}>
                  {line}
                </div>
              ))
            ) : (
              <div className="line missing">No address on file - don&apos;t ship yet.</div>
            )}
            {buyer?.phone && <div className="phone">{buyer.phone}</div>}
          </div>
          <img src="/label/sparkle.png" alt="" className="sparkle" />
          <div className="footer">
            Pixl · {order.item_name || "item"} · Order #{order.id}
          </div>
        </div>
      </div>
      <style>{`
        html, body { margin: 0; padding: 0; background: #e8e8e8; }
        .sheet {
          width: 210mm;
          height: 297mm;
          position: relative;
          background: #fff;
          margin: 20px auto;
          box-shadow: 0 0 0 1px #ddd;
        }
        .label {
          position: absolute;
          top: 0;
          right: 0;
          width: 105mm;
          height: 148.5mm;
          box-sizing: border-box;
          padding: 7mm;
          border: 0.4mm dashed #aaa;
          display: flex;
          flex-direction: column;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #111;
        }
        .wordmark {
          height: 9mm;
          width: auto;
          image-rendering: pixelated;
          display: block;
        }
        .address-block {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          margin-top: 6mm;
        }
        .ship-to {
          font-size: 8pt;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #888;
          margin-bottom: 2.5mm;
        }
        .name { font-size: 15pt; font-weight: 700; margin-bottom: 1.5mm; }
        .line { font-size: 12pt; line-height: 1.45; }
        .line.missing { color: #c0392b; font-style: italic; font-size: 11pt; }
        .phone { font-size: 11pt; margin-top: 2.5mm; color: #333; }
        .sparkle {
          position: absolute;
          bottom: 7mm;
          right: 7mm;
          width: 8mm;
          height: 8mm;
          image-rendering: pixelated;
          opacity: 0.9;
        }
        .footer { font-size: 7pt; color: #999; }
        @media print {
          @page { size: A4; margin: 0; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .sheet, .sheet * { visibility: visible !important; }
          .sheet {
            position: fixed !important;
            inset: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </>
  );
}
