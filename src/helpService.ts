import { InlineKeyboard } from "grammy";
import { TELEGRAM_MESSAGE_LIMIT } from "./format";

export const HELP_CALLBACK_PREFIX = "help:";
export const HELP_PERMISSION_MESSAGE = "❌ Aapko is help section ki permission nahi hai.";
export const PUBLIC_HELP_MESSAGE =
  "Yeh bot links access ke liye hai. /start bhejo aur available pages dekho.";

export type HelpSection = "menu" | "owner" | "links" | "broadcast" | "stats" | "examples" | "all";

const SECTION_ALIASES = new Map<string, HelpSection>([
  ["", "menu"],
  ["menu", "menu"],
  ["owner", "owner"],
  ["sudo", "owner"],
  ["admin", "owner"],
  ["addsudo", "owner"],
  ["rmsudo", "owner"],
  ["listsudo", "owner"],
  ["links", "links"],
  ["link", "links"],
  ["addlink", "links"],
  ["addlinks", "links"],
  ["removelink", "links"],
  ["removepage", "links"],
  ["listpages", "links"],
  ["preview", "links"],
  ["broadcast", "broadcast"],
  ["broardcast", "broadcast"],
  ["broardacast", "broadcast"],
  ["broadcaststatus", "broadcast"],
  ["stats", "stats"],
  ["cache", "stats"],
  ["reloadcache", "stats"],
  ["examples", "examples"],
  ["example", "examples"],
  ["all", "all"],
  ["full", "all"],
  ["guide", "all"],
]);

export function parseHelpSection(input: string): HelpSection | undefined {
  return SECTION_ALIASES.get(input.trim().toLowerCase());
}

export function buildHelpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("👑 Owner", `${HELP_CALLBACK_PREFIX}owner`)
    .text("🛠 Links", `${HELP_CALLBACK_PREFIX}links`)
    .row()
    .text("📣 Broadcast", `${HELP_CALLBACK_PREFIX}broadcast`)
    .text("📊 Stats", `${HELP_CALLBACK_PREFIX}stats`)
    .row()
    .text("⚡ Examples", `${HELP_CALLBACK_PREFIX}examples`)
    .text("📖 Full Guide", `${HELP_CALLBACK_PREFIX}all`);
}

export function getHelpMessage(section: HelpSection): string {
  switch (section) {
    case "owner":
      return OWNER_HELP;
    case "links":
      return LINKS_HELP;
    case "broadcast":
      return BROADCAST_HELP;
    case "stats":
      return STATS_HELP;
    case "examples":
      return EXAMPLES_HELP;
    case "all":
      return FULL_GUIDE_INTRO;
    case "menu":
      return HELP_MENU;
  }
}

export function getFullGuideMessages(): string[] {
  return [OWNER_HELP, LINKS_HELP, BROADCAST_HELP, STATS_HELP, EXAMPLES_HELP].flatMap(splitTelegramMessage);
}

export function assertHelpMessagesFit(): void {
  const messages = [HELP_MENU, OWNER_HELP, LINKS_HELP, BROADCAST_HELP, STATS_HELP, EXAMPLES_HELP, FULL_GUIDE_INTRO];
  for (const message of messages) {
    if (message.length > TELEGRAM_MESSAGE_LIMIT) {
      throw new Error(`Help message too long: ${message.slice(0, 40)}`);
    }
  }
}

function splitTelegramMessage(message: string): string[] {
  if (message.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [message];
  }

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of message.split("\n\n")) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > TELEGRAM_MESSAGE_LIMIT) {
      if (current) {
        chunks.push(current);
      }
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

const HELP_MENU = [
  "📚 Bot Help Center",
  "",
  "Yaha se aap bot ke saare admin features easily samajh sakte ho.",
  "",
  "👑 Owner Commands",
  "Sudo/admin add-remove karne ke liye.",
  "",
  "🛠 Link Management",
  "Links add/remove/list/preview karne ke liye.",
  "",
  "📣 Broadcast System",
  "Sab users ko message/photo/video/sticker/document bhejne ke liye.",
  "",
  "📊 Stats & Cache",
  "Bot ka data, users, pages aur cache check karne ke liye.",
  "",
  "⚡ Quick Examples",
  "Fast copy-paste examples.",
  "",
  "Use buttons below ya direct command:",
  "- /help owner",
  "- /help links",
  "- /help broadcast",
  "- /help stats",
  "- /help examples",
  "- /help all",
].join("\n");

const OWNER_HELP = [
  "👑 Owner Commands Guide",
  "",
  "Owner wo user hai jiska ID .env ke OWNER_IDS me hai. Owner ke paas full control hota hai.",
  "",
  "1. /addsudo <user_id ya @username>",
  "",
  "Ye command kya karta hai:",
  "Owner kisi trusted user ko Sudo Admin bana sakta hai. Sudo Admin links add/remove, stats check, cache clear, aur broadcast kar sakta hai.",
  "",
  "Kaise use karna hai:",
  "/addsudo 123456789",
  "/addsudo @username",
  "",
  "Example:",
  "/addsudo 987654321",
  "",
  "Important note:",
  "@username se sudo add tabhi hoga jab us user ne pehle bot me /start ya koi message bheja ho. Telegram bot random username ko user ID me convert nahi kar sakta. Best method numeric user ID use karna hai.",
  "",
  "Sudo admin kya kar sakta hai:",
  "✅ /addlink",
  "✅ /addlinks",
  "✅ /removelink",
  "✅ /removepage",
  "✅ /listpages",
  "✅ /preview",
  "✅ /stats",
  "✅ /reloadcache",
  "✅ /broadcast",
  "",
  "Sudo admin kya nahi kar sakta:",
  "❌ /addsudo",
  "❌ /rmsudo",
  "❌ /listsudo",
  "",
  "2. /rmsudo <user_id ya @username>",
  "",
  "Ye command kya karta hai:",
  "Owner kisi Sudo Admin ki admin power hata sakta hai.",
  "",
  "Kaise use karna hai:",
  "/rmsudo 123456789",
  "/rmsudo @username",
  "",
  "Example:",
  "/rmsudo 987654321",
  "",
  "Important note:",
  "Owner ko remove nahi kiya ja sakta kyunki Owner .env ke OWNER_IDS se control hota hai.",
  "",
  "3. /listsudo",
  "",
  "Ye command kya karta hai:",
  "Active sudo admins ki list dikhegi.",
  "",
  "Kaise use karna hai:",
  "/listsudo",
  "",
  "Example output:",
  "👑 Active Sudo Admins",
  "1. 987654321 @username | added: 2026-06-05",
  "",
  "Note: Ye section sirf Owner commands explain karta hai. Sudo admin ye commands use nahi kar sakta.",
].join("\n");

const LINKS_HELP = [
  "🛠 Link Management Guide",
  "",
  "Yaha se aap bot me links add/remove/list/preview kar sakte ho. Bot automatically har 50 links ke baad next page bana deta hai.",
  "",
  "Pagination rule:",
  "- 1 se 50 links = Page 1",
  "- 51 se 100 links = Page 2",
  "- 101 se 150 links = Page 3",
  "- Page unlock tabhi ho jata hai jab us page me kam se kam 1 link aa jaye.",
  "- Har page par numbering 1 se start hoti hai.",
  "",
  "1. /addlink <url>",
  "",
  "Ye command kya karta hai:",
  "Ek single link add karta hai.",
  "",
  "Kaise use karna hai:",
  "/addlink https://example.com/video",
  "",
  "Example:",
  "/addlink https://www.diskwala.com/app/example",
  "",
  "Success par:",
  "✅ Link add ho gaya.",
  "Total links: X",
  "Total pages: Y",
  "",
  "Common mistake:",
  "❌ /addlink example.com",
  "✅ /addlink https://example.com",
  "",
  "2. /addlinks",
  "",
  "Ye command kya karta hai:",
  "Ek saath multiple links add karta hai. Har link new line me likho.",
  "",
  "Format:",
  "/addlinks",
  "https://example.com/a",
  "https://example.com/b",
  "https://example.com/c",
  "",
  "Note:",
  "Galat lines automatically ignore ho jayengi. Bot ek hi summary reply bhejega.",
  "",
  "3. /removelink <page> <number>",
  "",
  "Ye command kya karta hai:",
  "Kisi specific page ke specific number ka link soft-remove karta hai.",
  "",
  "Format:",
  "/removelink <page> <number>",
  "",
  "Example:",
  "/removelink 2 5",
  "",
  "Iska matlab:",
  "Page 2 ka 5th link remove hoga.",
  "",
  "Important:",
  "Har page me numbering 1 se 50 hoti hai. Page 2 ka 1st link global 51st link ho sakta hai, lekin command me page ke andar wala number dena hai.",
  "",
  "4. /removepage <page>",
  "",
  "Ye command kya karta hai:",
  "Pura page ke up to 50 active links remove karta hai.",
  "",
  "Example:",
  "/removepage 2",
  "",
  "Warning:",
  "Is command ko carefully use karo.",
  "",
  "5. /listpages",
  "Total links, total pages, removed links, aur page info dekhne ke liye.",
  "",
  "6. /preview <page>",
  "Kisi page ko owner/admin preview kar sakta hai.",
  "Example: /preview 2",
].join("\n");

const BROADCAST_HELP = [
  "📣 Broadcast System Guide",
  "",
  "Broadcast se aap bot start/interact kar chuke sab users ko message bhej sakte ho.",
  "",
  "Important:",
  "Bot sirf un users ko broadcast bhej sakta hai jinhone bot ko /start ya message bheja hai. Telegram bot silently bot open karne wale users ki list nahi deta.",
  "",
  "1. Text broadcast",
  "",
  "Format:",
  "/broadcast Your message",
  "",
  "Example:",
  "/broadcast Hello sabko 🔥 Aaj new links update ho gaye hain. /start check karo.",
  "",
  "2. Reply broadcast",
  "",
  "Ye command kya karta hai:",
  "Aap kisi bhi message par reply karke /broadcast bhej sakte ho. Bot wahi message sab users ko copy karke bhej dega.",
  "",
  "Supported:",
  "✅ Text",
  "✅ Photo with caption",
  "✅ Video with caption",
  "✅ Sticker",
  "✅ Document/file",
  "✅ GIF/animation",
  "✅ Audio",
  "✅ Voice",
  "✅ Video note where supported",
  "",
  "How to use:",
  "Step 1: Bot chat me photo/video/sticker/document bhejo.",
  "Step 2: Us message par reply karo.",
  "Step 3: Reply me likho:",
  "/broadcast",
  "",
  "Example:",
  "Photo bhejo with caption: New update 🔥",
  "Phir us photo par reply: /broadcast",
  "",
  "Result:",
  "Photo + caption sab tracked users ko jayega.",
  "",
  "Broadcast aliases:",
  "Agar spelling mistake ho jaye to ye bhi chalega:",
  "- /broardcast",
  "- /broardacast",
  "",
  "Rate limit note:",
  "Broadcast slow and safe queue se hota hai taki Telegram rate limit na aaye. Zyada users hone par thoda time lag sakta hai.",
  "",
  "Blocked users:",
  "Agar kisi user ne bot block kiya hoga, bot usko blocked mark kar dega aur broadcast continue rahega.",
  "",
  "3. /broadcaststatus",
  "Current broadcast progress dekhne ke liye.",
].join("\n");

const STATS_HELP = [
  "📊 Stats & Cache Guide",
  "",
  "1. /stats",
  "",
  "Ye command kya karta hai:",
  "Bot ka full status dikhata hai.",
  "",
  "Stats me dikhega:",
  "- MongoDB connected hai ya nahi",
  "- Active links",
  "- Removed links",
  "- Total pages",
  "- Links per page",
  "- Tracked users",
  "- Broadcast users",
  "- Blocked users",
  "- Cache entries",
  "- Uptime",
  "- Memory usage",
  "- Bot mode polling/webhook",
  "",
  "Tracked users ka matlab:",
  "Jinhone bot me /start ya koi message bheja hai.",
  "",
  "Broadcast users ka matlab:",
  "Tracked users me se jo blocked nahi hain.",
  "",
  "Blocked users ka matlab:",
  "Jinhone bot block kar diya ya Telegram ne message reject kiya.",
  "",
  "2. /reloadcache",
  "",
  "Ye command kya karta hai:",
  "Bot page cache clear karta hai.",
  "",
  "Format:",
  "/reloadcache",
  "",
  "Kab use kare:",
  "Agar links update ke baad page old dikh raha ho, to /reloadcache run karo.",
].join("\n");

const EXAMPLES_HELP = [
  "⚡ Quick Copy-Paste Examples",
  "",
  "Add one link:",
  "/addlink https://example.com/video1",
  "",
  "Add many links:",
  "/addlinks",
  "https://example.com/video1",
  "https://example.com/video2",
  "https://example.com/video3",
  "",
  "Remove page 1 ka 5th link:",
  "/removelink 1 5",
  "",
  "Remove full page 2:",
  "/removepage 2",
  "",
  "Preview page 1:",
  "/preview 1",
  "",
  "Add sudo admin:",
  "/addsudo 123456789",
  "",
  "Remove sudo admin:",
  "/rmsudo 123456789",
  "",
  "List sudo admins:",
  "/listsudo",
  "",
  "Text broadcast:",
  "/broadcast Hello sabko 🔥 New update aa gaya hai.",
  "",
  "Media broadcast:",
  "Photo/video/sticker/document par reply karke:",
  "/broadcast",
  "",
  "Stats:",
  "/stats",
  "",
  "Clear cache:",
  "/reloadcache",
].join("\n");

const FULL_GUIDE_INTRO = [
  "📖 Full Guide",
  "",
  "Full guide lamba hai, isliye bot sections alag-alag messages me bhejega.",
].join("\n");
