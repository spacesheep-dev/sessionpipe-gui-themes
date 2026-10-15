// SPDX-License-Identifier: Apache-2.0
// The plugin against a fake Channel: what it sends and when (choices on a permission,
// one message per attention, the wait before sending, quiet hours, the machine filter,
// dry run), a reply becoming a suggestion, the token never reaching a log line, and
// deactivate cancelling a pending wait. Runs on the built dist/index.js.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPlugin, formatMessage, inQuietHours } from "../dist/index.js";

const TOKEN = "123456:ABC-very-secret-token";

function fakeChannel() {
  const sent = [];
  let reply = { status: "timeout" };
  let onAwait = null;
  return {
    sent,
    setReply(r) {
      reply = r;
    },
    waitForAwait: () =>
      new Promise((resolve) => {
        onAwait = resolve;
      }),
    async send(message, options) {
      sent.push({ message, choices: options?.choices });
      return { id: String(sent.length) };
    },
    async awaitReply(opts) {
      onAwait?.(opts);
      return reply;
    },
  };
}

function session(over = {}) {
  return {
    key: "claude-code:abc",
    harness: "claude-code",
    id: "abc",
    machine: "misha-air",
    cwd: "~/proj",
    title: "Fix the tests",
    state: "needs_you",
    stateSince: "2026-10-15T10:00:00Z",
    startedAt: "2026-10-15T09:00:00Z",
    lastAt: "2026-10-15T10:00:00Z",
    maxTier: 3,
    backfilled: false,
    source: "http",
    counts: {
      events: 1,
      turns: 0,
      tools: 0,
      toolErrors: 0,
      subagents: 0,
      compactions: 0,
      filesChanged: 0,
      attentions: 1,
    },
    openAttentions: [],
    children: 0,
    recentTools: [],
    flags: [],
    turnStats: { count: 0 },
    ...over,
  };
}

const permission = (id = "perm-1") => ({
  attentionId: id,
  kind: "permission",
  tool: "Bash",
  message: "rm -rf dist",
  at: "2026-10-15T10:00:00Z",
  answerable: true,
});

function fakeApi(settings, sessions) {
  const logs = [];
  const suggestions = [];
  let listener = null;
  let onSettings = null;
  return {
    logs,
    suggestions,
    emit: (m) => listener?.(m),
    changeSettings: (s) => onSettings?.(s),
    api: {
      version: 1,
      host: {
        name: "sessionpipe-gui",
        version: "0.1.0",
        urls: { local: "http://localhost:7373", lan: ["http://10.0.0.5:7373"] },
      },
      manifest: {
        id: "ping-a-human",
        name: "ping-a-human",
        version: "0.1.0",
        kind: "plugin",
        entry: "dist/index.js",
        api: 1,
      },
      log: (level, msg, data) => logs.push(`${level}: ${msg} ${data === undefined ? "" : JSON.stringify(data)}`),
      settings: {
        get: () => ({ ...settings }),
        onChange: (l) => {
          onSettings = l;
          return () => {};
        },
      },
      events: {
        subscribe: (l) => {
          listener = l;
          return () => {
            listener = null;
          };
        },
        snapshot: () => ({ at: "", sessions: Object.values(sessions), machines: [], stats: {} }),
      },
      sessions: {
        get: (key) => sessions[key],
        url: (key) => `http://10.0.0.5:7373/s/${key.replace(":", "/")}?k=key`,
      },
      suggest: (s) => suggestions.push(s),
      storage: { get: async () => null, set: async () => {} },
      fetch: globalThis.fetch,
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("helpers", () => {
  it("formats three lines with one emoji", () => {
    assert.equal(
      formatMessage("🔔", "Needs you", "misha-air", "Bash: rm -rf dist", "http://x"),
      "🔔 Needs you · misha-air\nBash: rm -rf dist\nhttp://x",
    );
  });
  it("quiet hours wrap midnight", () => {
    const at = (h, m = 0) => new Date(2026, 9, 15, h, m);
    assert.equal(inQuietHours("22:00-08:00", at(23)), true);
    assert.equal(inQuietHours("22:00-08:00", at(3)), true);
    assert.equal(inQuietHours("22:00-08:00", at(8)), false);
    assert.equal(inQuietHours("22:00-08:00", at(12)), false);
    assert.equal(inQuietHours("09:00-17:00", at(12)), true);
    assert.equal(inQuietHours("", at(12)), false);
    assert.equal(inQuietHours("nonsense", at(12)), false);
  });
});

describe("ping-a-human plugin", () => {
  it("asks Allow / Deny on a permission, once, and turns the tap into a suggestion", async () => {
    const ch = fakeChannel();
    ch.setReply({ status: "answered", answer: "Allow", respondent: { id: "1", name: "Misha" } });
    const s = session({ openAttentions: [permission()] });
    const f = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0 }, { [s.key]: s });
    const plugin = createPlugin({ createChannel: () => ch });
    const handle = await plugin.activate(f.api);
    const awaited = ch.waitForAwait();
    f.emit({ kind: "event", event: { type: "attention.needed" }, session: s });
    f.emit({ kind: "session", session: s }); // the attention is repeated on every message
    await tick();
    assert.equal(ch.sent.length, 1);
    assert.deepEqual(ch.sent[0].choices, ["Allow", "Deny"]);
    assert.equal(
      ch.sent[0].message,
      "🔔 Needs you · misha-air\nBash: rm -rf dist\nhttp://10.0.0.5:7373/s/claude-code/abc?k=key",
    );
    const opts = await awaited;
    assert.equal(opts.timeoutMs, 120_000);
    assert.deepEqual(opts.sinceRef, { id: "1" });
    await tick();
    assert.deepEqual(f.suggestions, [
      { session: s.key, attentionId: "perm-1", decision: "allow", by: "Misha on Telegram" },
    ]);
    // The token is in the settings; no log line carries it.
    assert.ok(f.logs.length > 0);
    for (const line of f.logs) assert.ok(!line.includes(TOKEN), line);
    for (const m of ch.sent) assert.ok(!m.message.includes(TOKEN));
    handle.deactivate();
  });

  it("a nameless respondent is 'Telegram'; Deny is a deny; free text is ignored", async () => {
    const ch = fakeChannel();
    ch.setReply({ status: "answered", answer: "deny", respondent: { id: "1" } });
    const s = session({ openAttentions: [permission("perm-2")] });
    const f = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0 }, { [s.key]: s });
    const handle = await createPlugin({ createChannel: () => ch }).activate(f.api);
    f.emit({ kind: "session", session: s });
    await tick();
    await tick();
    assert.deepEqual(f.suggestions, [{ session: s.key, attentionId: "perm-2", decision: "deny", by: "Telegram" }]);
    handle.deactivate();

    const ch2 = fakeChannel();
    ch2.setReply({ status: "answered", answer: "later please", respondent: { id: "1", name: "M" } });
    const s2 = session({ openAttentions: [permission("perm-3")] });
    const f2 = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0 }, { [s2.key]: s2 });
    const h2 = await createPlugin({ createChannel: () => ch2 }).activate(f2.api);
    f2.emit({ kind: "session", session: s2 });
    await tick();
    await tick();
    assert.equal(f2.suggestions.length, 0);
    assert.ok(f2.logs.some((l) => l.includes("not Allow or Deny")));
    h2.deactivate();
  });

  it("a question is notified without buttons; a non-answerable twin and askOnPermission off send plainly", async () => {
    const ch = fakeChannel();
    const s = session({
      openAttentions: [
        { attentionId: "q1", kind: "question", message: "Which branch?", at: "2026-10-15T10:00:00Z" },
        { ...permission("notif-9"), answerable: false },
      ],
    });
    const f = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0 }, { [s.key]: s });
    const handle = await createPlugin({ createChannel: () => ch }).activate(f.api);
    f.emit({ kind: "session", session: s });
    await tick();
    assert.equal(ch.sent.length, 2);
    const q = ch.sent.find((m) => m.message.startsWith("❓"));
    assert.equal(
      q.message,
      "❓ Question · misha-air\nquestion: Which branch?\nhttp://10.0.0.5:7373/s/claude-code/abc?k=key",
    );
    assert.equal(q.choices, undefined);
    assert.equal(ch.sent.find((m) => m.message.startsWith("🔔")).choices, undefined);
    handle.deactivate();

    const ch2 = fakeChannel();
    const s2 = session({ openAttentions: [permission("perm-4")] });
    const f2 = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0, askOnPermission: false }, { [s2.key]: s2 });
    const h2 = await createPlugin({ createChannel: () => ch2 }).activate(f2.api);
    f2.emit({ kind: "session", session: s2 });
    await tick();
    assert.equal(ch2.sent.length, 1);
    assert.equal(ch2.sent[0].choices, undefined);
    h2.deactivate();
  });

  it("waits minSilenceS, sends nothing when the prompt closes meanwhile, and deactivate cancels the wait", async () => {
    const ch = fakeChannel();
    const s = session({ openAttentions: [permission("perm-5")] });
    const sessions = { [s.key]: s };
    const f = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0.05 }, sessions);
    const handle = await createPlugin({ createChannel: () => ch }).activate(f.api);
    f.emit({ kind: "session", session: s });
    await tick();
    assert.equal(ch.sent.length, 0);
    // Answered at the desk: the store now shows it closed.
    sessions[s.key] = session({ openAttentions: [], state: "working" });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(ch.sent.length, 0);
    // A new one, then deactivate before the wait is over.
    sessions[s.key] = session({ openAttentions: [permission("perm-6")] });
    f.emit({ kind: "session", session: sessions[s.key] });
    handle.deactivate();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(ch.sent.length, 0);
  });

  it("keeps quiet in quiet hours and for machines not on the list", async () => {
    const ch = fakeChannel();
    const s = session({ openAttentions: [permission("perm-7")] });
    const f = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0, quietHours: "22:00-08:00" }, { [s.key]: s });
    const handle = await createPlugin({ createChannel: () => ch, now: () => new Date(2026, 9, 15, 23, 30) }).activate(
      f.api,
    );
    f.emit({ kind: "session", session: s });
    await tick();
    assert.equal(ch.sent.length, 0);
    assert.ok(f.logs.some((l) => l.includes("quiet hours")));
    handle.deactivate();

    const ch2 = fakeChannel();
    const f2 = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0, machines: "other-box, lab" }, { [s.key]: s });
    const h2 = await createPlugin({ createChannel: () => ch2 }).activate(f2.api);
    f2.emit({ kind: "session", session: s });
    await tick();
    assert.equal(ch2.sent.length, 0);
    h2.deactivate();
  });

  it("session_done, flags and control_delivered when asked for; not by default", async () => {
    const ch = fakeChannel();
    const working = session({ openAttentions: [], state: "working" });
    const f = fakeApi(
      { botToken: TOKEN, chatId: "42", minSilenceS: 0, events: ["session_done", "flags", "control_delivered"] },
      { [working.key]: working },
    );
    const handle = await createPlugin({ createChannel: () => ch }).activate(f.api);
    f.emit({ kind: "session", session: working });
    f.emit({
      kind: "session",
      session: session({
        openAttentions: [],
        state: "working",
        flags: [{ kind: "slow_tool", since: "t1", detail: "Bash · 4 m" }],
      }),
    });
    f.emit({ kind: "session", session: session({ openAttentions: [], state: "done" }) });
    f.emit({ kind: "session", session: session({ openAttentions: [], state: "done" }) });
    f.emit({
      kind: "control",
      message: {
        id: "m1",
        machineId: "x",
        kind: "prompt",
        session: working.key,
        text: "run the tests",
        at: "",
        expiresAt: "",
        outcome: "delivered",
      },
    });
    f.emit({
      kind: "control",
      message: {
        id: "m1",
        machineId: "x",
        kind: "prompt",
        session: working.key,
        text: "run the tests",
        at: "",
        expiresAt: "",
        outcome: "delivered",
      },
    });
    await tick();
    const heads = ch.sent.map((m) => m.message.split("\n")[0]);
    assert.deepEqual(heads, ["🚩 Flag · misha-air", "✅ Session done · misha-air", "📨 Delivered · misha-air"]);
    assert.equal(ch.sent[0].message.split("\n")[1], "slow_tool: Bash · 4 m");
    assert.equal(ch.sent[2].message.split("\n")[1], "prompt: run the tests");
    handle.deactivate();

    const ch2 = fakeChannel();
    const f2 = fakeApi({ botToken: TOKEN, chatId: "42", minSilenceS: 0 }, { [working.key]: working });
    const h2 = await createPlugin({ createChannel: () => ch2 }).activate(f2.api);
    f2.emit({ kind: "session", session: working });
    f2.emit({ kind: "session", session: session({ openAttentions: [], state: "done" }) });
    await tick();
    assert.equal(ch2.sent.length, 0);
    h2.deactivate();
  });

  it("dry run logs instead of sending, and never makes a channel", async () => {
    let made = 0;
    const s = session({ openAttentions: [permission("perm-8")] });
    const f = fakeApi({ dryRun: true, minSilenceS: 0 }, { [s.key]: s });
    const handle = await createPlugin({
      createChannel: () => {
        made++;
        return fakeChannel();
      },
    }).activate(f.api);
    f.emit({ kind: "session", session: s });
    await tick();
    assert.equal(made, 0);
    assert.ok(f.logs.some((l) => l.startsWith("info: would ask Allow / Deny")));
    handle.deactivate();
  });

  it("a missing configuration fails activate with a secret-free message", async () => {
    const f = fakeApi({ minSilenceS: 0 }, {});
    await assert.rejects(
      createPlugin({
        createChannel: () => {
          throw new Error("No ping-a-human configuration found (run 'ping-a-human setup').");
        },
      }).activate(f.api),
      /No ping-a-human configuration/,
    );
  });

  it("new settings rebuild the channel", async () => {
    const chats = [];
    const s = session({ openAttentions: [] });
    const f = fakeApi({ botToken: TOKEN, chatId: "1", minSilenceS: 0 }, { [s.key]: s });
    const handle = await createPlugin({
      createChannel: (settings) => {
        chats.push(settings.chatId);
        return fakeChannel();
      },
    }).activate(f.api);
    f.changeSettings({ botToken: TOKEN, chatId: "2", minSilenceS: 0 });
    assert.deepEqual(chats, ["1", "2"]);
    handle.deactivate();
  });
});
