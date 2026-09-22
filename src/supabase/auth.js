import { supabase, isSupabaseConfigured } from "./client.js";

let currentUser = null;
let authInitialized = false;

export async function initAuth() {
  if (authInitialized) return currentUser;

  try {
    if (isSupabaseConfigured()) {
      // Try to get existing session
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        currentUser = session.user;
        console.log("[Auth] Existing session:", currentUser.id);
      } else {
        // Sign in anonymously
        console.log("[Auth] No session, signing in anonymously...");
        const { data, error } = await supabase.auth.signInAnonymously();
        
        if (error) {
          console.error("[Auth] Anonymous sign-in failed:", error);
          // Fallback to mock user if anonymous auth not enabled
          currentUser = createMockUser();
        } else {
          currentUser = data.user;
          console.log("[Auth] Anonymous sign-in success:", currentUser.id);
        }
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          currentUser = session.user;
        } else if (event === 'SIGNED_OUT') {
          currentUser = null;
        }
      });
    } else {
      // Mock mode
      const stored = localStorage.getItem("mock-supabase-user");
      if (stored) {
        currentUser = JSON.parse(stored);
      } else {
        currentUser = createMockUser();
        localStorage.setItem("mock-supabase-user", JSON.stringify(currentUser));
      }
      console.log("[Auth] Mock user:", currentUser.id);
    }
  } catch (e) {
    console.warn("[Auth] Init failed, using mock:", e);
    currentUser = createMockUser();
  }

  authInitialized = true;
  return currentUser;
}

function createMockUser() {
  return {
    id: "user-" + Math.random().toString(36).slice(2, 11) + "-" + Date.now().toString(36),
    aud: "authenticated",
    role: "authenticated",
    isMock: true,
  };
}

export function getCurrentUser() {
  return currentUser;
}

export function getCurrentUserId() {
  return currentUser?.id || null;
}

export async function signOut() {
  try {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem("mock-supabase-user");
    currentUser = null;
    authInitialized = false;
  } catch (e) {
    console.warn("[Auth] Sign out failed:", e);
  }
}

export async function ensureProfile(username) {
  if (!currentUser) {
    await initAuth();
  }

  const userId = getCurrentUserId();
  if (!userId) throw new Error("No user ID");

  try {
    if (isSupabaseConfigured()) {
      // Check if profile exists
      const { data: existing, error: fetchError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (existing && !fetchError) {
        // Update username if provided and different
        if (username && existing.username !== username) {
          const { data, error } = await supabase
            .from("profiles")
            .update({ username, updated_at: new Date().toISOString() })
            .eq("id", userId)
            .select()
            .single();
          
          if (error) throw error;
          return data;
        }
        return existing;
      }

      // Create profile
      const { data, error } = await supabase
        .from("profiles")
        .insert({
          id: userId,
          username: username || "Player",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } else {
      // Mock mode - store in localStorage
      const profiles = JSON.parse(localStorage.getItem("mock-profiles") || "{}");
      if (!profiles[userId]) {
        profiles[userId] = {
          id: userId,
          username: username || "Player",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        localStorage.setItem("mock-profiles", JSON.stringify(profiles));
      } else if (username && profiles[userId].username !== username) {
        profiles[userId].username = username;
        profiles[userId].updated_at = new Date().toISOString();
        localStorage.setItem("mock-profiles", JSON.stringify(profiles));
      }
      return profiles[userId];
    }
  } catch (e) {
    console.warn("[Auth] ensureProfile failed:", e);
    // Return mock profile
    return {
      id: userId,
      username: username || "Player",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

export async function getProfile(userId = null) {
  const id = userId || getCurrentUserId();
  if (!id) return null;

  try {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    } else {
      const profiles = JSON.parse(localStorage.getItem("mock-profiles") || "{}");
      return profiles[id] || null;
    }
  } catch (e) {
    console.warn("[Auth] getProfile failed:", e);
    return null;
  }
}
