import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let isConfigured = false;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
    });
    isConfigured = true;
    console.log("[Supabase] Client initialized");
  } catch (e) {
    console.warn("[Supabase] Failed to initialize client:", e);
    supabase = null;
    isConfigured = false;
  }
} else {
  console.warn("[Supabase] Not configured - missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Multiplayer will use local mock.");
}

// Mock client for development without Supabase
class MockSupabaseClient {
  constructor() {
    this.auth = {
      user: () => null,
      session: () => null,
      signInAnonymously: async () => {
        const mockUser = {
          id: "mock-" + Math.random().toString(36).slice(2, 11),
          aud: "authenticated",
          role: "authenticated",
        };
        localStorage.setItem("mock-supabase-user", JSON.stringify(mockUser));
        return { data: { user: mockUser, session: { user: mockUser } }, error: null };
      },
      getUser: async () => {
        const stored = localStorage.getItem("mock-supabase-user");
        if (stored) {
          return { data: { user: JSON.parse(stored) }, error: null };
        }
        return { data: { user: null }, error: null };
      },
      getSession: async () => {
        const stored = localStorage.getItem("mock-supabase-user");
        if (stored) {
          const user = JSON.parse(stored);
          return { data: { session: { user } }, error: null };
        }
        return { data: { session: null }, error: null };
      },
      onAuthStateChange: (cb) => {
        // Mock: immediately call with current user
        const stored = localStorage.getItem("mock-supabase-user");
        if (stored) {
          cb("SIGNED_IN", { user: JSON.parse(stored) });
        }
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    };
    this._lobbies = new Map();
    this._profiles = new Map();
    this._lobbyPlayers = new Map();
    this._channels = new Map();
  }

  from(table) {
    return new MockQueryBuilder(table, this);
  }

  channel(name, opts) {
    if (!this._channels.has(name)) {
      this._channels.set(name, new MockChannel(name));
    }
    return this._channels.get(name);
  }

  removeChannel(channel) {
    this._channels.delete(channel.name);
  }
}

class MockQueryBuilder {
  constructor(table, client) {
    this.table = table;
    this.client = client;
    this.filters = [];
    this._single = false;
  }

  select() { return this; }
  eq(col, val) { this.filters.push({ col, val }); return this; }
  neq(col, val) { this.filters.push({ col, val, op: 'neq' }); return this; }
  in(col, vals) { this.filters.push({ col, vals, op: 'in' }); return this; }
  single() { this._single = true; return this; }
  order() { return this; }
  limit() { return this; }

  async then(resolve) {
    // Very basic mock - return empty for now
    // Real implementation would filter based on this.filters
    const result = { data: this._single ? null : [], error: null };
    resolve(result);
  }

  async insert(data) {
    return { data, error: null };
  }

  async update(data) {
    return { data, error: null };
  }

  async delete() {
    return { data: null, error: null };
  }
}

class MockChannel {
  constructor(name) {
    this.name = name;
    this.listeners = [];
  }

  on(event, filter, cb) {
    if (typeof filter === 'function') {
      cb = filter;
    }
    this.listeners.push({ event, cb });
    return this;
  }

  subscribe(cb) {
    if (cb) cb("SUBSCRIBED");
    return this;
  }

  send() {
    return Promise.resolve();
  }

  track() {
    return Promise.resolve();
  }

  untrack() {
    return Promise.resolve();
  }

  unsubscribe() {
    return Promise.resolve();
  }
}

// Use mock if not configured
if (!isConfigured) {
  supabase = new MockSupabaseClient();
}

export { supabase, isConfigured };
export const isSupabaseConfigured = () => isConfigured;

// Helper to check if we should use real Supabase
export const shouldUseSupabase = () => {
  return isConfigured && supabase && !(supabase instanceof MockSupabaseClient);
};
