// SPDX-License-Identifier: Apache-2.0
// ping-a-human for the sessionpipe GUI: a Telegram message when a session needs you,
// through ping-a-human's channel (npx ping-a-human setup once). On a permission prompt
// the message carries Allow / Deny buttons; the tap comes back as a *suggestion* beside
// the prompt in the GUI, which a person confirms with their passkey. This plugin never
// answers anything itself: the receiver holds no key, and neither does it.
//
// Shape: `createPlugin(deps)` builds the plugin around a channel factory, so tests hand
// in a fake channel; the default export uses ping-a-human's real one.
import { homedir } from "node:os";
import type { Attention, SessionSummary, StreamMessage } from "@sessionpipe-gui/theme-types/api";
import type { LogLevel, Plugin, PluginApi } from "@sessionpipe-gui/theme-types/plugin-api";
import type { Channel } from "ping-a-human/dist/channel.js";
import { createChannel as realCreateChannel } from "ping-a-human/dist/channel-factory.js";
import { loadConfig } from "ping-a-human/dist/config.js";

export type EventKind = "needs_you" | "question" | "turn_error" | "session_done" | "flags" | "control_delivered";

export interface Settings {
  configPath: string;
  botToken?: string;
  chatId?: string;
  events: EventKind[];
  askOnPermission: boolean;
  quietHours?: string;
  machines?: string;
  minSilenceS: number;
  dryRun: boolean;
}

export const DEFAULTS: Settings = {
  configPath: "~/.config/ping-a-human/config.json",
  events: ["needs_you", "question", "turn_error"],
  askOnPermission: true,
  minSilenceS: 20,
  dryRun: false,
};

export const REPLY_TIMEOUT_MS = 120_000;

export interface Deps {
  /** Builds the channel from the settings; ping-a-human's factory by default. */
  createChannel: (settings: Settings) => Channel;
  /** The clock, for quiet hours (tests). */
  now?: () => Date;
}

/** ping-a-human's channel from the settings: the overrides when both are set, else the
 *  config file (path from the settings, `~` expanded), each override on top. */
export function channelFromSettings(settings: Settings): Channel {
  const path = settings.configPath.replace(/^~(?=$|[\\/])/, homedir());
  const token = settings.botToken?.trim();
  const chatId = settings.chatId?.trim();
  if (token && chatId) return realCreateChannel({ config: { telegram: { botToken: token, chatId } } });
  const base = loadConfig({ path });
  return realCreateChannel({
    config: { telegram: { botToken: token || base.telegram.botToken, chatId: chatId || base.telegram.chatId } },
  });
}

/** "22:00-08:00" → whether `now` falls inside (the range may wrap midnight). */
export function inQuietHours(spec: string | undefined, now: Date): boolean {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(spec ?? "");
  if (!m) return false;
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (from === to) return false;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

const title = (s: SessionSummary): string =>
  s.title ?? (s.cwd ? (s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd) : s.id.slice(0, 8));

/** "🔔 <title> · <machine>\n<tool>: <message>\n<url>": one emoji, three lines. */
export function formatMessage(
  emoji: string,
  head: string,
  machine: string | undefined,
  line: string,
  url: string,
): string {
  return `${emoji} ${head}${machine ? ` · ${machine}` : ""}\n${line}\n${url}`;
}

const attentionKind = (a: Attention): EventKind | null => {
  switch (a.kind) {
    case "question":
      return "question";
    case "error":
      return "turn_error";
    case "permission":
    case "elicitation":
    case "idle":
      return "needs_you";
    default:
      return null;
  }
};

const EMOJI: Record<EventKind, string> = {
  needs_you: "🔔",
  question: "❓",
  turn_error: "⚠️",
  session_done: "✅",
  flags: "🚩",
  control_delivered: "📨",
};

const HEAD: Record<EventKind, string> = {
  needs_you: "Needs you",
  question: "Question",
  turn_error: "Turn error",
  session_done: "Session done",
  flags: "Flag",
  control_delivered: "Delivered",
};

export function createPlugin(deps: Deps): Plugin {
  return {
    async activate(api: PluginApi) {
      const now = deps.now ?? (() => new Date());
      let settings: Settings = { ...DEFAULTS, ...api.settings.get<Partial<Settings>>() };
      let channel: Channel | null = null;
      let closed = false;
      const log = (level: LogLevel, msg: string, data?: unknown) => api.log(level, msg, data);

      const connect = () => {
        if (settings.dryRun) {
          channel = null;
          log("info", "dry run: messages are logged, not sent");
          return;
        }
        channel = deps.createChannel(settings); // throws a secret-free message when there is no config
        log("info", "Telegram channel ready");
      };
      connect();

      /** Per attention id: the session it belongs to and the wait before sending (null once
       *  sent). Forgotten when the attention closes, so a repeat never sends twice. */
      const tracked = new Map<string, { key: string; timer: ReturnType<typeof setTimeout> | null }>();
      const lastState = new Map<string, SessionSummary["state"]>();
      const flagsSeen = new Map<string, Set<string>>();
      const delivered = new Set<string>();
      /** Asks go one at a time: ping-a-human's channel reads one reply stream. */
      let askQueue: Promise<void> = Promise.resolve();

      const wanted = (kind: EventKind) => settings.events.includes(kind);
      const machineOk = (machine: string | undefined): boolean => {
        const list = (settings.machines ?? "")
          .split(",")
          .map((m) => m.trim().toLowerCase())
          .filter(Boolean);
        return list.length === 0 || (!!machine && list.includes(machine.toLowerCase()));
      };
      const quiet = (): boolean => inQuietHours(settings.quietHours, now());

      const send = async (text: string): Promise<void> => {
        if (quiet()) {
          log("debug", "quiet hours: not sent", { text });
          return;
        }
        if (!channel) {
          log("info", settings.dryRun ? "would send" : "no channel; not sent", { text });
          return;
        }
        try {
          await channel.send(text);
        } catch (e) {
          log("error", `send failed: ${(e as Error).message}`);
        }
      };

      /** A permission prompt with Allow / Deny buttons; the tap becomes a suggestion. */
      const ask = (session: SessionSummary, a: Attention, text: string): void => {
        if (quiet()) {
          log("debug", "quiet hours: not asked", { text });
          return;
        }
        if (!channel) {
          log("info", settings.dryRun ? "would ask Allow / Deny" : "no channel; not asked", { text });
          return;
        }
        const ch = channel;
        askQueue = askQueue
          .then(async () => {
            if (closed) return;
            const ref = await ch.send(text, { choices: ["Allow", "Deny"] });
            const reply = await ch.awaitReply({ timeoutMs: REPLY_TIMEOUT_MS, sinceRef: ref });
            if (closed) return;
            if (reply.status === "timeout") {
              log("debug", "no reply in time", { attention: a.attentionId });
              return;
            }
            const answer = reply.answer.trim().toLowerCase();
            if (answer !== "allow" && answer !== "deny") {
              log("debug", "reply was not Allow or Deny; ignored", { attention: a.attentionId });
              return;
            }
            const who = reply.respondent.name ? `${reply.respondent.name} on Telegram` : "Telegram";
            try {
              api.suggest({ session: session.key, attentionId: a.attentionId, decision: answer, by: who });
              log("info", `suggested ${answer}`, { attention: a.attentionId, by: who });
            } catch (e) {
              log("debug", `suggestion dropped: ${(e as Error).message}`);
            }
          })
          .catch((e: unknown) => log("error", `ask failed: ${(e as Error).message}`));
      };

      const fire = (key: string, a: Attention, kind: EventKind): void => {
        const t = tracked.get(a.attentionId);
        if (t) t.timer = null;
        if (closed) return;
        const session = api.sessions.get(key);
        if (!session || !session.openAttentions.some((x) => x.attentionId === a.attentionId)) {
          tracked.delete(a.attentionId); // answered at the desk while we waited
          return;
        }
        const line = `${a.tool ?? a.kind}: ${a.message ?? title(session)}`;
        const text = formatMessage(EMOJI[kind], HEAD[kind], session.machine, line, api.sessions.url(key));
        const answerable = a.answerable ?? !a.attentionId.startsWith("notif-");
        if (a.kind === "permission" && answerable && settings.askOnPermission) ask(session, a, text);
        else void send(text);
      };

      const onSession = (s: SessionSummary): void => {
        if (!machineOk(s.machine)) return;
        const open = new Set(s.openAttentions.map((a) => a.attentionId));
        // Closed attentions: forget them, and cancel a wait that has not fired.
        for (const [id, t] of tracked) {
          if (t.key !== s.key || open.has(id)) continue;
          if (t.timer) clearTimeout(t.timer);
          tracked.delete(id);
        }
        for (const a of s.openAttentions) {
          if (tracked.has(a.attentionId)) continue;
          const kind = attentionKind(a);
          if (!kind || !wanted(kind)) continue;
          const entry = { key: s.key, timer: null as ReturnType<typeof setTimeout> | null };
          tracked.set(a.attentionId, entry);
          entry.timer = setTimeout(() => fire(s.key, a, kind), Math.max(0, settings.minSilenceS) * 1000);
        }
        // Session done, once.
        const prev = lastState.get(s.key);
        lastState.set(s.key, s.state);
        if (s.state === "done" && prev !== undefined && prev !== "done" && wanted("session_done")) {
          void send(formatMessage(EMOJI.session_done, HEAD.session_done, s.machine, title(s), api.sessions.url(s.key)));
        }
        // New flags, once each.
        if (wanted("flags")) {
          const seen = flagsSeen.get(s.key) ?? new Set<string>();
          flagsSeen.set(s.key, seen);
          for (const f of s.flags ?? []) {
            const id = `${f.kind}@${f.since}`;
            if (seen.has(id)) continue;
            seen.add(id);
            void send(
              formatMessage(EMOJI.flags, HEAD.flags, s.machine, `${f.kind}: ${f.detail}`, api.sessions.url(s.key)),
            );
          }
        }
      };
      const onMessage = (m: StreamMessage): void => {
        switch (m.kind) {
          case "event":
          case "session":
            onSession(m.session);
            return;
          case "forgotten":
            lastState.delete(m.key);
            flagsSeen.delete(m.key);
            return;
          case "control": {
            const c = m.message;
            if (c.outcome !== "delivered" || delivered.has(c.id) || !wanted("control_delivered")) return;
            delivered.add(c.id);
            const session = c.session ? api.sessions.get(c.session) : undefined;
            if (session && !machineOk(session.machine)) return;
            const line = `${c.kind}${c.text ? `: ${c.text.slice(0, 200)}` : ""}`;
            const url = c.session
              ? api.sessions.url(c.session)
              : (api.host.urls.https ?? api.host.urls.lan[0] ?? api.host.urls.local);
            void send(formatMessage(EMOJI.control_delivered, HEAD.control_delivered, session?.machine, line, url));
            return;
          }
          default:
            return;
        }
      };

      // Attentions already open at start count from now (they are repeated on every message).
      for (const s of api.events.snapshot().sessions) lastState.set(s.key, s.state);
      const offEvents = api.events.subscribe(onMessage);
      const offSettings = api.settings.onChange((next) => {
        settings = { ...DEFAULTS, ...(next as Partial<Settings>) };
        try {
          connect();
        } catch (e) {
          channel = null;
          log("error", `settings changed but the channel could not be made: ${(e as Error).message}`);
        }
      });

      return {
        deactivate() {
          closed = true;
          offEvents();
          offSettings();
          for (const t of tracked.values()) if (t.timer) clearTimeout(t.timer);
          tracked.clear();
          channel = null;
        },
      };
    },
  };
}

const plugin: Plugin = createPlugin({ createChannel: channelFromSettings });
export default plugin;
