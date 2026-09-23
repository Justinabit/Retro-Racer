import { supabase, isSupabaseConfigured } from "../supabase/client.js";
// Anchor wall time once; subsequent browser clock changes cannot move countdown.
class ServerClock {
  constructor() {
    this.epoch = Date.now() - performance.now();
    this.rtt = null;
  }
  now() {
    return this.epoch + performance.now();
  }
  async sync() {
    if (!isSupabaseConfigured()) return;
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const { data, error } = await supabase.rpc("race_server_time");
      const end = performance.now();
      if (error) throw error;
      const time = Date.parse(data);
      if (Number.isFinite(time) && end - start < best) {
        best = end - start;
        this.epoch = time - (start + end) / 2;
        this.rtt = best;
      }
    }
  }
}
export const serverClock = new ServerClock();
