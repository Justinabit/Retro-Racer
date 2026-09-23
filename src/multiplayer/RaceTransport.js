// Realtime does not authenticate playerId fields inside arbitrary payloads.
// Each race member therefore owns ONE write-authorized private topic. Everyone
// subscribes to these same bounded topics; the topic, not the payload, identifies
// the sender. SQL 005 restricts writes to auth.uid() and reads to race members.
export class RaceTransport {
  constructor({
    raceId,
    playerId,
    members,
    receive,
    presence,
    status,
    client,
    online = true,
    verbose = false,
    retryDelay = 2000,
  }) {
    Object.assign(this, {
      raceId,
      playerId,
      members: [...new Set(members)],
      receive,
      presence,
      status,
      client,
      online,
      verbose,
      retryDelay,
    });
    this.channels = new Map();
    this.ready = new Set();
    this.timers = new Map();
    this.disposed = false;
    this.busy = false;
    this.sent = 0;
    this.received = 0;
    this.failed = 0;
  }
  log(...args) {
    if (this.verbose) console.debug("[NETWORK]", ...args);
  }
  start() {
    if (this.channels.size || this.mock || this.disposed) return;
    this.status("CONNECTING");
    if (!this.online) {
      this.mock = new BroadcastChannel(`pixel-race:${this.raceId}`);
      this.mock.onmessage = ({ data }) => {
        if (
          data.playerId !== this.playerId &&
          this.members.includes(data.playerId)
        ) {
          this.received++;
          this.receive(data.playerId, data.payload);
        }
      };
      this.status("CONNECTED");
      return;
    }
    for (const id of this.members) this.join(id);
  }
  join(id) {
    if (this.disposed || !this.members.includes(id) || this.channels.has(id))
      return;
    const channel = this.client.channel(`race:${this.raceId}:${id}`, {
      config: {
        private: true,
        broadcast: { self: false, ack: false },
        presence: { key: id },
      },
    });
    this.channels.set(id, channel);
    channel
      .on("broadcast", { event: "state" }, ({ payload }) => {
        if (
          this.disposed ||
          this.channels.get(id) !== channel ||
          id === this.playerId
        )
          return;
        this.received++;
        this.receive(id, payload);
      })
      .on("presence", { event: "sync" }, () => {
        if (!this.disposed && this.channels.get(id) === channel)
          this.presence(id, Object.keys(channel.presenceState()).length > 0);
      })
      .subscribe(async (state) => {
        if (this.disposed || this.channels.get(id) !== channel) return;
        this.log(id, state);
        if (state === "SUBSCRIBED") {
          clearTimeout(this.timers.get(id));
          this.timers.delete(id);
          this.ready.add(id);
          if (id === this.playerId) {
            try {
              await channel.track({ connected: true });
            } catch (error) {
              this.log("Presence deferred", error);
            }
          }
          if (this.disposed || this.channels.get(id) !== channel) return;
          this.status(
            this.ready.size === this.members.length
              ? "CONNECTED"
              : "CONNECTING",
          );
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state)) {
          this.ready.delete(id);
          this.status(this.ready.size ? "RECONNECTING" : "DISCONNECTED");
          // Recreate with all handlers bound before subscribe. A single timer per
          // topic; no send while unsubscribed (avoids SDK HTTP fallback/queues).
          if (!this.timers.has(id))
            this.timers.set(
              id,
              setTimeout(
                async () => {
                  this.timers.delete(id);
                  this.channels.delete(id);
                  await this.client.removeChannel(channel);
                  if (!this.disposed) this.join(id);
                },
                this.retryDelay + (Math.random() * this.retryDelay) / 4,
              ),
            );
        }
      });
  }
  send(payload) {
    if (this.disposed || this.busy) return false;
    if (this.mock) {
      this.mock.postMessage({ playerId: this.playerId, payload });
      this.sent++;
      return true;
    }
    const channel = this.channels.get(this.playerId);
    if (
      !channel ||
      !this.ready.has(this.playerId) ||
      !this.client.realtime.isConnected()
    )
      return false;
    if ((this.client.realtime.conn?.bufferedAmount || 0) > 65536) return false;
    // A maximum of one in-flight movement packet. Frames continue to simulate;
    // after settlement the next send samples fresh physics, never an old queue.
    this.busy = true;
    this.sent++;
    Promise.resolve()
      .then(() => {
        if (this.disposed || !this.ready.has(this.playerId)) return "dropped";
        return channel.send({ type: "broadcast", event: "state", payload });
      })
      .then((result) => {
        if (result !== "ok") this.failed++;
      })
      .catch(() => {
        this.failed++;
      })
      .finally(() => {
        this.busy = false;
      });
    return true;
  }
  removeMember(id) {
    if (id === this.playerId) return;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const channel = this.channels.get(id);
    this.channels.delete(id);
    this.ready.delete(id);
    this.members = this.members.filter((member) => member !== id);
    if (channel) void this.client.removeChannel(channel);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const channel of this.channels.values())
      void this.client.removeChannel(channel);
    this.channels.clear();
    this.ready.clear();
    this.mock?.close();
    this.mock = null;
  }
}
