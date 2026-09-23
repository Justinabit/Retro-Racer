import test from "node:test";
import assert from "node:assert/strict";
import { RaceTransport } from "../src/multiplayer/RaceTransport.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function fixture() {
  const log = [],
    channels = [],
    statuses = [],
    received = [];
  const client = {
    realtime: { isConnected: () => true, conn: { bufferedAmount: 0 } },
    channel(topic, config) {
      const ch = {
        topic,
        config,
        listeners: [],
        on(type, filter, cb) {
          assert.equal(this.subscribed, undefined, "bind before subscribe");
          this.listeners.push({ type, filter, cb });
          return this;
        },
        subscribe(cb) {
          this.subscribed = true;
          this.status = cb;
          return this;
        },
        track() {
          log.push("track");
          return Promise.resolve("ok");
        },
        presenceState() {
          return {};
        },
        send(packet) {
          log.push(packet);
          return Promise.resolve("ok");
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      log.push(`remove:${ch.topic}`);
      ch.status("CLOSED");
      return Promise.resolve();
    },
  };
  const transport = new RaceTransport({
    raceId: "session",
    playerId: "a",
    members: ["a", "b"],
    client,
    receive: (...args) => received.push(args),
    presence: () => {},
    status: (s) => statuses.push(s),
    retryDelay: 10,
  });
  return { transport, client, channels, statuses, received, log };
}
test("idempotent start, owned-topic receive identity, no pre-subscription send, one in-flight packet", async () => {
  const f = fixture(),
    t = f.transport;
  t.start();
  t.start();
  assert.equal(f.channels.length, 2);
  assert.equal(t.send({ x: 1 }), false);
  for (const c of f.channels) await c.status("SUBSCRIBED");
  assert.equal(f.statuses.at(-1), "CONNECTED");
  assert.equal(f.channels[0].config.config.private, true);
  f.channels[1].listeners
    .find((l) => l.type === "broadcast")
    .cb({ payload: { playerId: "a" } });
  assert.equal(
    f.received[0][0],
    "b",
    "sender comes from authorized topic, not spoofed payload",
  );
  let release;
  f.channels[0].send = (p) => {
    f.log.push(p);
    return new Promise((r) => {
      release = r;
    });
  };
  assert.equal(t.send({ x: 1 }), true);
  await wait(0);
  assert.equal(t.send({ x: 2 }), false);
  assert.equal(t.send({ x: 3 }), false);
  release("ok");
  await wait(0);
  assert.equal(
    f.log.filter((e) => e?.type === "broadcast").length,
    1,
    "no backlog of old movement",
  );
  f.client.realtime.conn.bufferedAmount = 70000;
  assert.equal(t.send({ x: 4 }), false);
  t.dispose();
  t.dispose();
  assert.equal(t.channels.size, 0);
  assert.equal(t.timers.size, 0);
  assert.equal(
    f.log.filter((e) => typeof e === "string" && e.startsWith("remove:"))
      .length,
    2,
  );
});
test("one reconnect timer, healthy rejoin cancels it, closed topic recreates with fresh listeners", async () => {
  const { transport: t, channels } = fixture();
  t.start();
  await channels[0].status("CHANNEL_ERROR");
  await channels[0].status("TIMED_OUT");
  assert.equal(t.timers.size, 1);
  await channels[0].status("SUBSCRIBED");
  assert.equal(t.timers.size, 0);
  await wait(25);
  assert.equal(channels.length, 2);
  await channels[0].status("CLOSED");
  await wait(40);
  assert.equal(channels.length, 3);
  assert.equal(t.channels.size, 2);
  assert.equal(channels[2].listeners.length, 2);
  await channels[2].status("SUBSCRIBED");
  t.removeMember("b");
  assert.equal(t.channels.size, 1);
  t.dispose();
  await wait(25);
  assert.equal(channels.length, 3);
});
test("dispose during failed join prevents late retries or handlers from reviving a race", async () => {
  const { transport: t, channels, received } = fixture();
  t.start();
  await channels[0].status("CHANNEL_ERROR");
  t.dispose();
  await channels[0].status("SUBSCRIBED");
  channels[1].listeners[0].cb({ payload: {} });
  await wait(30);
  assert.equal(received.length, 0);
  assert.equal(channels.length, 2);
  assert.equal(t.send({}), false);
});
