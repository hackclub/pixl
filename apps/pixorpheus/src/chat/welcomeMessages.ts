import { app } from "../slack/app.js";
import { PIXL_MAIN_CHANNEL } from "../constants.js";
import { botIdentity } from "../slack/identity.js";
import { recordMemberJoin } from "./newMembersDigest.js";

// Private welcome DM sent to each new main-channel member (the public welcome is
// the daily digest, see newMembersDigest.ts).
const WELCOME_DM = `hey! welcome to Pixl :yay:

i'm pixo, i answer questions from the Pixl docs. you can:
• ping me in any channel
• DM me right here
• use /pixl-help to see everything i can do!

quick links:
• play: https://pixl.hackclub.com/play
• docs: https://pixl.hackclub.com/docs

stuck on something a helper should see? post in <#C0B6STY9G5N> :hii:
want to hear updates about the ysws? join <#C0B627CFHEY>  :pixl-yay:`;

async function sendWelcomeDM(userId: string): Promise<void> {
  try {
    const im = await app.client.conversations.open({ users: userId });
    const channel = im.channel?.id;
    if (channel) await app.client.chat.postMessage({ channel, text: WELCOME_DM });
  } catch (e: any) {
    console.error("welcome DM error:", e?.message ?? e);
  }
}

app.event("member_joined_channel", async ({ event }) => {
  if (event.user === botIdentity.userId) return;

  // Main channel: send the newcomer a private welcome DM and record the join
  // for the daily digest. No instant public message.
  if (event.channel === PIXL_MAIN_CHANNEL) {
    await sendWelcomeDM(event.user);
    await recordMemberJoin(event.user, event.channel);
  }
});
