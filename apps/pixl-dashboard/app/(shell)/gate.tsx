import { cn } from "@/lib/cn";
import { loginUrl } from "@/lib/urls";

// [@media(max-height:620px)]: short viewports (landscape phones) get a
// smaller splash and button.
const message = cn(
  "mb-[28px] max-w-[34em] text-[16px] leading-[1.7] text-[#6b5c46]",
  "[@media(max-height:620px)]:mb-[20px] [@media(max-height:620px)]:text-[14px]",
);

/**
 * Signed-out gate for every shell page. The only action is Log In. The game's
 * own boot splash is the background, so a signed-out visitor lands on the
 * same screen the game itself starts on (fixed colours, not themed).
 */
export function Gate({ next, error }: { next: string; error?: string | null }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#f5eed2] p-[24px]">
      <div className="flex max-w-[620px] flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={cn(
            "block h-auto w-(--sw) max-w-none [--sw:min(1000px,92vw)] [image-rendering:pixelated]",
            "mt-[calc(var(--sw)*-0.19)] mb-[calc(var(--sw)*-0.20)]",
            "[@media(max-height:620px)]:[--sw:min(560px,70vw)]",
          )}
          src="/img/boot-splash.png"
          alt="Pixl"
        />
        {error ? (
          <p role="alert" className={message}>
            That login didn&apos;t go through ({error.replace(/_/g, " ")}). Try again.
          </p>
        ) : (
          <p className={message}>Log in with Hack Club to see your projects, shop and orders.</p>
        )}
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-[18px]",
            "[@media(max-height:620px)]:gap-[12px]",
          )}
        >
          <a
            className={cn(
              "inline-block border-2 border-r-8 border-b-8 border-black bg-black px-[36px] py-[14px]",
              "font-pixel text-[32px] leading-none text-[#f5eed2] hover:bg-[#2b2b33] hover:text-[#f5eed2]",
              "transition-[background-color] duration-150",
              "[@media(max-height:620px)]:px-[26px] [@media(max-height:620px)]:py-[12px]",
              "[@media(max-height:620px)]:text-[24px]",
            )}
            href={loginUrl(next)}
          >
            Log In
          </a>
        </div>
      </div>
    </div>
  );
}
