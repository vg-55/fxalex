// Outbound notification push — Telegram / Discord webhook.
// Silent no-op when credentials are absent. Never throws (scanner must not fail
// because of a push failure).

import type { NotificationRow } from "@/db/schema";

const SEV_EMOJI: Record<string, string> = {
  info: "ℹ️",
  watch: "👀",
  actionable: "🚀",
  critical: "🚨",
};

function formatText(n: NotificationRow): string {
  const emoji = SEV_EMOJI[n.severity] ?? "•";
  const pair = n.pair ? ` [${n.pair}]` : "";
  return `${emoji} *${n.severity.toUpperCase()}*${pair}\n*${n.title}*\n${n.body}`;
}

async function sendTelegram(n: NotificationRow): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatText(n),
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    /* swallow */
  }
}

async function sendDiscord(n: NotificationRow): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const color =
      n.severity === "critical" ? 0xdc2626 :
      n.severity === "actionable" ? 0x10b981 :
      n.severity === "watch" ? 0xf59e0b : 0x64748b;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: `${SEV_EMOJI[n.severity] ?? "•"} ${n.title}`,
            description: n.body,
            color,
            fields: [
              ...(n.pair ? [{ name: "Pair", value: n.pair, inline: true }] : []),
              { name: "Severity", value: n.severity, inline: true },
            ],
            timestamp: new Date(n.createdAt).toISOString(),
          },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    /* swallow */
  }
}

export async function pushExternal(n: NotificationRow): Promise<void> {
  // Parallel; both are best-effort.
  await Promise.all([sendTelegram(n), sendDiscord(n)]);
}

export function hasExternalNotifier(): boolean {
  return Boolean(
    (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) ||
    process.env.DISCORD_WEBHOOK_URL
  );
}
