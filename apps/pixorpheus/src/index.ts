import { app, http } from "./slack/app.js";
import { setBotIdentity } from "./slack/identity.js";
import { loadMemory, loadPersonalityMemory } from "./memory/users.js";
import { loadProgramMemory } from "./memory/program.js";
import { loadStyleMemory } from "./memory/style.js";
import { loadPendingPolls } from "./chat/polls.js";
import { autoCloseOldTickets } from "./tickets/service.js";
import { scheduleDailyCompact } from "./chat/dailyCompact.js";

// Side-effect imports, each of these registers its Bolt listeners
// (commands/actions/events) against the shared `app`, or HTTP routes on `http`.
import "./tickets/events.js";
import "./tickets/actions.js";
import "./tickets/views.js";
import "./pixelate/command.js";
import "./chat/welcomeMessages.js";
import "./chat/pixlDelete.js";
import "./chat/messageHandler.js";
import "./chat/polls.js";
import "./commands/misc.js";
import "./commands/social.js";
import "./commands/helpers.js";
import "./commands/memoryCommands.js";
import "./commands/ai.js";
import "./commands/ship.js";
import "./github/webhook.js";
import "./shop/webhook.js";
import "./external/ticketApi.js";
import "./external/dmApi.js";
import "./external/reviewPostApi.js";
import "./external/shopOrderAlertApi.js";

(async () => {
  // Slack over Socket Mode (no inbound Slack traffic), then the in-cluster
  // HTTP endpoints on PORT.
  await app.start();
  const port = Number(process.env.PORT) || 3000;
  await new Promise<void>((resolve) => http.listen(port, () => resolve()));
  try {
    const auth = await app.client.auth.test();
    setBotIdentity(auth.user_id!, auth.bot_id!);
  } catch (_) {}
  await loadMemory();
  await loadPersonalityMemory();
  await loadProgramMemory();
  await loadPendingPolls();
  await loadStyleMemory();
  autoCloseOldTickets().catch(() => {});
  setInterval(() => autoCloseOldTickets().catch(() => {}), 24 * 60 * 60 * 1000);
  scheduleDailyCompact();
  console.log("pixorpheus is running.");
})();
