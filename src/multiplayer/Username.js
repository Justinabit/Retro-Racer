import { ensureProfile, getCurrentUserId } from "../supabase/auth.js";
import { supabase, isSupabaseConfigured } from "../supabase/client.js";

// Username validation
export function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: "Username is required" };
  }

  const trimmed = username.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, error: "Username cannot be empty" };
  }

  if (trimmed.length < 3) {
    return { valid: false, error: "Username must be at least 3 characters" };
  }

  if (trimmed.length > 16) {
    return { valid: false, error: "Username must be at most 16 characters" };
  }

  // Check for dangerous characters - only allow letters, numbers, spaces
  if (!/^[a-zA-Z0-9 ]+$/.test(trimmed)) {
    return { valid: false, error: "Only letters, numbers, and spaces allowed" };
  }

  // Prevent multiple consecutive spaces
  const normalized = trimmed.replace(/\s+/g, ' ').trim();

  // Check for HTML/JS injection attempts
  const dangerous = ['<', '>', 'script', 'javascript:', 'onerror', 'onload', 'eval', 'select ', 'insert ', 'delete ', 'drop ', 'union ', '--', ';'];
  const lower = normalized.toLowerCase();
  for (const pattern of dangerous) {
    if (lower.includes(pattern)) {
      return { valid: false, error: "Username contains invalid characters" };
    }
  }

  // Check for only spaces
  if (normalized.replace(/ /g, '').length === 0) {
    return { valid: false, error: "Username cannot be only spaces" };
  }

  return { valid: true, username: normalized };
}

export function sanitizeUsername(username) {
  if (!username) return "";
  // Remove HTML tags, trim, normalize spaces
  return username
    .replace(/<[^>]*>/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 16);
}

export async function checkUsernameUnique(username) {
  const normalized = username.trim().toLowerCase();
  
  try {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username")
        .ilike("username", username)
        .limit(1);

      if (error) throw error;

      // If found, check if it's the current user
      if (data && data.length > 0) {
        const currentId = getCurrentUserId();
        if (data[0].id === currentId) {
          return { unique: true }; // Own username is okay
        }
        return { unique: false, error: "Username already taken" };
      }
      return { unique: true };
    } else {
      // Mock mode - check localStorage
      const profiles = JSON.parse(localStorage.getItem("mock-profiles") || "{}");
      const currentId = getCurrentUserId();
      for (const [id, profile] of Object.entries(profiles)) {
        if (id !== currentId && profile.username.toLowerCase() === normalized) {
          return { unique: false, error: "Username already taken" };
        }
      }
      return { unique: true };
    }
  } catch (e) {
    console.warn("[Username] check unique failed:", e);
    return { unique: true }; // Allow on error to not block user
  }
}

export async function createOrUpdateUsername(username) {
  const validation = validateUsername(username);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const uniqueCheck = await checkUsernameUnique(validation.username);
  if (!uniqueCheck.unique) {
    throw new Error(uniqueCheck.error);
  }

  const profile = await ensureProfile(validation.username);
  
  // Also save to local storage for quick access
  localStorage.setItem("pixel-racer-username", validation.username);
  
  // Update game storage
  try {
    const raw = JSON.parse(localStorage.getItem("pixel-racer-save") || "{}");
    raw.name = validation.username;
    localStorage.setItem("pixel-racer-save", JSON.stringify(raw));
  } catch {}

  return profile;
}

export function getStoredUsername() {
  return localStorage.getItem("pixel-racer-username") || null;
}

export function hasStoredUsername() {
  const username = getStoredUsername();
  return username && validateUsername(username).valid;
}

// UI helper to show username prompt
export function createUsernamePrompt(onComplete, existingUsername = "") {
  const overlay = document.createElement("div");
  overlay.className = "username-overlay";
  overlay.innerHTML = `
    <div class="username-modal">
      <div class="eyebrow">WELCOME TO THE GRID</div>
      <h1>ENTER YOUR <em>USERNAME</em></h1>
      <p>Choose a name that will appear above your car and in multiplayer lobbies.</p>
      <div class="username-input-group">
        <input 
          type="text" 
          id="username-input" 
          maxlength="16" 
          placeholder="e.g. SpeedKing"
          value="${existingUsername ? existingUsername.replace(/"/g, '&quot;') : ''}"
          autocomplete="off"
          spellcheck="false"
        />
        <small>3-16 characters, letters, numbers, spaces only</small>
        <div id="username-error" class="username-error" hidden></div>
      </div>
      <div class="username-actions">
        <button class="primary" id="username-submit">CONTINUE →</button>
      </div>
      <div class="username-examples">
        <span>Examples: Justin, Vince123, RetroRacer, SpeedKing</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const input = overlay.querySelector("#username-input");
  const errorEl = overlay.querySelector("#username-error");
  const submit = overlay.querySelector("#username-submit");

  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    input.classList.add("error");
  };

  const clearError = () => {
    errorEl.hidden = true;
    input.classList.remove("error");
  };

  const submitUsername = async () => {
    const value = input.value;
    const validation = validateUsername(value);
    
    if (!validation.valid) {
      showError(validation.error);
      return;
    }

    submit.disabled = true;
    submit.textContent = "CHECKING...";
    clearError();

    try {
      const profile = await createOrUpdateUsername(validation.username);
      overlay.remove();
      if (onComplete) onComplete(profile);
    } catch (e) {
      showError(e.message);
      submit.disabled = false;
      submit.textContent = "CONTINUE →";
    }
  };

  input.addEventListener("input", () => {
    clearError();
    // Auto-remove invalid characters
    const sanitized = input.value.replace(/[^a-zA-Z0-9 ]/g, '');
    if (sanitized !== input.value) {
      input.value = sanitized;
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitUsername();
    }
  });

  submit.addEventListener("click", submitUsername);

  // Focus input
  setTimeout(() => input.focus(), 100);

  return overlay;
}
