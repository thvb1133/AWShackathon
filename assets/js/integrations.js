/* ============================================================
   integrations.js — how Beyond Orbit reaches the rest of your stack.

   A claim worth being precise about. This app does not contain ten
   thousand hand-written connectors, and any product that says it does
   is usually counting somebody else's catalogue. What it has is an
   outbound webhook that speaks the format the automation platforms
   expect — and *those* platforms reach the ten thousand apps.

     Zapier      ~8,000 apps
     Make        ~2,000 apps
     n8n         ~1,000 nodes, and self-hostable
     Power Automate, IFTTT, Pipedream, Slack, Discord, Google Chat,
     Microsoft Teams, and any endpoint you can write yourself.

   Paste a webhook URL, and an approved draft is delivered to it. From
   there your Zap or scenario can post to LinkedIn, file a Jira ticket,
   append a row to a sheet, send the email, or whatever you have built.

   Two rules the whole module obeys:
     1. Nothing is ever sent without your approval, unless you have
        explicitly ticked auto-approve on that specific job.
     2. Every delivery is logged with its response, so you can see
        exactly what left the device and what came back.
   ============================================================ */

const CONNECTIONS = "bo_connections_v1";
const LOG = "bo_delivery_log";

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full */ }
};

/* ==================================================================
   Destination types
   ================================================================== */

/**
 * Each destination knows how to shape a payload for its receiver.
 * Slack and Discord want a specific field; the automation platforms
 * take whatever JSON you give them.
 */
export const DESTINATIONS = {
  zapier: {
    id: "zapier",
    name: "Zapier",
    emoji: "⚡",
    reach: "~8,000 apps",
    hint: "Make a Zap, choose the Webhooks by Zapier trigger, and paste its Catch Hook URL here.",
    url: "https://zapier.com/apps/webhook/integrations",
    test: "https://hooks.zapier.com/hooks/catch/…",
    shape: (payload) => payload,
  },
  make: {
    id: "make",
    name: "Make (Integromat)",
    emoji: "🧩",
    reach: "~2,000 apps",
    hint: "Add a Custom Webhook module in a Make scenario and paste its address here.",
    url: "https://www.make.com/en/integrations",
    test: "https://hook.eu2.make.com/…",
    shape: (payload) => payload,
  },
  n8n: {
    id: "n8n",
    name: "n8n",
    emoji: "🔗",
    reach: "~1,000 nodes, self-hostable and free",
    hint: "Add a Webhook node in n8n, copy the production URL. Runs on your own machine if you want nothing in the cloud.",
    url: "https://n8n.io/integrations",
    test: "https://your-n8n/webhook/…",
    shape: (payload) => payload,
  },
  slack: {
    id: "slack",
    name: "Slack",
    emoji: "💬",
    reach: "Your workspace",
    hint: "Create an Incoming Webhook in your Slack app settings and paste the URL.",
    url: "https://api.slack.com/messaging/webhooks",
    test: "https://hooks.slack.com/services/…",
    shape: (payload) => ({
      text: `*${payload.title}*\n${payload.summary}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: payload.title.slice(0, 150) } },
        { type: "section", text: { type: "mrkdwn", text: payload.summary.slice(0, 2900) } },
        ...(payload.bullets || []).slice(0, 6).map((b) => ({
          type: "section",
          text: { type: "mrkdwn", text: `• *${b.role}:* ${b.headline}`.slice(0, 2900) },
        })),
      ],
    }),
  },
  discord: {
    id: "discord",
    name: "Discord",
    emoji: "🎮",
    reach: "Your server",
    hint: "Channel settings → Integrations → Webhooks → New Webhook, then copy the URL.",
    url: "https://support.discord.com/hc/en-us/articles/228383668",
    test: "https://discord.com/api/webhooks/…",
    shape: (payload) => ({
      content: `**${payload.title}**`,
      embeds: [
        {
          title: payload.brief?.slice(0, 250) || "Beyond Orbit",
          description: payload.summary.slice(0, 3900),
          color: 0x9b6bff,
          fields: (payload.bullets || []).slice(0, 5).map((b) => ({
            name: b.role.slice(0, 250),
            value: String(b.headline).slice(0, 1000),
          })),
        },
      ],
    }),
  },
  teams: {
    id: "teams",
    name: "Microsoft Teams",
    emoji: "🏢",
    reach: "Your Teams channel",
    hint: "Channel → Connectors → Incoming Webhook, then paste its URL.",
    url: "https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook",
    test: "https://outlook.office.com/webhook/…",
    shape: (payload) => ({
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      themeColor: "9B6BFF",
      summary: payload.title,
      title: payload.title,
      text: payload.summary,
    }),
  },
  custom: {
    id: "custom",
    name: "Any endpoint",
    emoji: "🛠️",
    reach: "Whatever you build",
    hint: "Your own server, a Cloudflare Worker, an AWS Lambda URL — anything that accepts a POST of JSON.",
    url: null,
    test: "https://your-service/hook",
    shape: (payload) => payload,
  },
};

export const DESTINATION_IDS = Object.keys(DESTINATIONS);

/** Guesses the destination type from the URL, so you rarely pick one. */
export function detectDestination(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("hooks.zapier.com")) return "zapier";
  if (u.includes("make.com") || u.includes("integromat")) return "make";
  if (u.includes("hooks.slack.com")) return "slack";
  if (u.includes("discord.com/api/webhooks") || u.includes("discordapp.com/api/webhooks")) return "discord";
  if (u.includes("office.com") || u.includes("office365.com") || u.includes("outlook.")) return "teams";
  if (u.includes("/webhook") || u.includes("n8n")) return "n8n";
  return "custom";
}

/* ==================================================================
   Saved connections
   ================================================================== */

export const connections = () => read(CONNECTIONS, []);

export function addConnection({ name, url, type }) {
  const clean = String(url || "").trim();
  if (!/^https:\/\//i.test(clean)) throw new Error("A webhook must be an https:// address.");
  const list = connections();
  const connection = {
    id: `c${Date.now().toString(36)}`,
    name: name || new URL(clean).host,
    url: clean,
    type: type || detectDestination(clean),
    created: Date.now(),
    deliveries: 0,
    lastStatus: null,
  };
  list.push(connection);
  write(CONNECTIONS, list);
  return connection;
}

export function removeConnection(connectionId) {
  write(CONNECTIONS, connections().filter((c) => c.id !== connectionId));
}

/* ==================================================================
   Delivery
   ================================================================== */

export const deliveryLog = () => read(LOG, []);

function logDelivery(entry) {
  const log = deliveryLog();
  log.unshift(entry);
  write(LOG, log.slice(0, 100));
}

/**
 * Posts a payload to a webhook.
 *
 * Webhook receivers frequently do not send CORS headers, which means a
 * browser cannot read the reply even when the POST is accepted. Rather
 * than call that a failure, the request falls back to a no-cors send
 * and reports honestly that it was dispatched but unverifiable — which
 * is exactly what happened.
 */
export async function fire(url, payload, { type } = {}) {
  const target = String(url || "").trim();
  if (!target) return { ok: false, error: "No webhook configured" };

  const destination = DESTINATIONS[type || detectDestination(target)] || DESTINATIONS.custom;
  const body = JSON.stringify({
    ...destination.shape({
      title: payload.title || "Beyond Orbit",
      summary: payload.summary || "",
      bullets: payload.bullets || [],
      brief: payload.brief || "",
    }),
    ...(destination.id === "custom" || destination.id === "zapier" || destination.id === "make" || destination.id === "n8n"
      ? { source: "Beyond Orbit", sentAt: new Date().toISOString() }
      : {}),
  });

  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    const result = {
      ok: res.ok,
      status: res.status,
      verified: true,
      ms: Math.round(performance.now() - started),
      destination: destination.name,
      at: Date.now(),
      title: payload.title,
    };
    logDelivery(result);
    bumpConnection(target, res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}`);
    return result;
  } catch (error) {
    // CORS or a network refusal. Try once more in no-cors mode: the POST
    // still arrives, we simply cannot read what came back.
    try {
      await fetch(target, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body,
      });
      const result = {
        ok: true,
        status: null,
        verified: false,
        note: "Sent, but the receiver did not allow this page to read the response, so delivery could not be confirmed.",
        ms: Math.round(performance.now() - started),
        destination: destination.name,
        at: Date.now(),
        title: payload.title,
      };
      logDelivery(result);
      bumpConnection(target, "sent (unverified)");
      return result;
    } catch (second) {
      const result = {
        ok: false,
        error: second.message || error.message,
        ms: Math.round(performance.now() - started),
        destination: destination.name,
        at: Date.now(),
        title: payload.title,
      };
      logDelivery(result);
      bumpConnection(target, `failed: ${result.error}`);
      return result;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function bumpConnection(url, status) {
  const list = connections();
  const connection = list.find((c) => c.url === url);
  if (!connection) return;
  connection.deliveries += 1;
  connection.lastStatus = status;
  connection.lastAt = Date.now();
  write(CONNECTIONS, list);
}

/** Sends a harmless sample so you can confirm the plumbing before trusting it. */
export function test(url, type) {
  return fire(
    url,
    {
      title: "🌌 Beyond Orbit test message",
      summary: "If you can read this in your app, the connection works. Nothing else has been sent.",
      brief: "connection test",
      bullets: [{ role: "Integration check", headline: "Delivered from your browser, on your instruction." }],
    },
    { type }
  );
}

/* ==================================================================
   Inbound: reading things in
   ================================================================== */

/**
 * Email is the one people always ask for, so here is the honest position.
 *
 * A static page cannot read your Gmail. There is no way around it: the
 * Gmail API requires an OAuth client that you register, and IMAP is not
 * reachable from a browser at all. Anyone claiming otherwise is either
 * running a server that holds your credentials, or not reading your mail.
 *
 * What works without giving anyone your password is a *bridge*: your own
 * Zapier, Make or n8n scenario watches the inbox and posts a summary to a
 * URL that this app polls. Your credentials stay with the platform you
 * already trust, and Beyond Orbit only ever sees the summary.
 */
export const INBOX_BRIDGE = {
  name: "Inbox bridge",
  why: "So JARVIS can tell you what is waiting before you open your mail.",
  steps: [
    "In Zapier, Make or n8n, create a scenario triggered by New Email (Gmail, Outlook, or IMAP — all supported there).",
    "Add a step that stores the sender, subject, received time and a one-line summary as JSON.",
    "Publish that JSON at a URL this app can read, or push it to a free store such as a GitHub Gist or a JSONBin.",
    "Paste that URL below. Beyond Orbit polls it and reports what is unread.",
  ],
  shape: `[
  { "from": "amit@example.com", "subject": "Launch slot confirmed", "at": "2026-08-07T09:14:00Z", "unread": true, "summary": "Pad booked for the 14th." }
]`,
};

const BRIDGE_URL = "bo_inbox_bridge";
export const getBridge = () => localStorage.getItem(BRIDGE_URL) || "";
export const setBridge = (url) => {
  const clean = String(url || "").trim();
  if (clean) localStorage.setItem(BRIDGE_URL, clean);
  else localStorage.removeItem(BRIDGE_URL);
  return getBridge();
};

/** Reads the bridge and reports what is unread, the way a secretary would. */
export async function readInbox() {
  const url = getBridge();
  if (!url) return { ok: false, configured: false, reason: "No inbox bridge configured." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : raw.messages || raw.items || [];
    const messages = list
      .map((m) => ({
        from: m.from || m.sender || "unknown",
        subject: m.subject || m.title || "(no subject)",
        at: m.at || m.date || m.received || null,
        unread: m.unread !== false,
        summary: m.summary || m.snippet || "",
      }))
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    const unread = messages.filter((m) => m.unread);
    return {
      ok: true,
      configured: true,
      total: messages.length,
      unread: unread.length,
      messages,
      spoken: unread.length
        ? `You have ${unread.length} unread message${unread.length === 1 ? "" : "s"}. ` +
          unread.slice(0, 3).map((m) => `From ${m.from}, ${m.subject}.`).join(" ") +
          (unread.length > 3 ? ` And ${unread.length - 3} more.` : "")
        : "Your inbox is clear. Nothing unread.",
    };
  } catch (error) {
    return { ok: false, configured: true, reason: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/** What the Company page prints about reach, without inflating it. */
export function reachSummary() {
  const platforms = ["zapier", "make", "n8n"].map((k) => DESTINATIONS[k]);
  return {
    connections: connections().length,
    deliveries: deliveryLog().length,
    platforms,
    honest:
      "Beyond Orbit ships one outbound webhook, not ten thousand connectors. It speaks the format Zapier, Make and n8n expect, " +
      "and those platforms reach roughly eight thousand, two thousand and one thousand apps respectively. " +
      "So the reach is real, but it is borrowed, and it costs you one paste of a URL.",
  };
}
