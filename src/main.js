import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-700-italic.css";
import "@fontsource/barlow-condensed/latin-800-italic.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/dm-sans/latin-800.css";
import "./style.css";
import { Game } from "./core/Game.js";

try {
  const game = new Game();
  if (import.meta.env.DEV) {
    window.__racer = game;
    window.__toggleDebug = () => game.toggleDebug();
    console.log("[Game] Dev mode - __racer available, __toggleDebug() to toggle debug");
    
    // Keyboard shortcut for debug: Ctrl+Shift+D
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        game.toggleDebug();
      }
    });
  }
} catch (error) {
  console.error(error);
  document.getElementById("ui").innerHTML =
    '<div class="error-screen"><h1>QUICK PIT STOP.</h1><p>Pixel Racer needs WebGL to hit the road. Enable hardware acceleration in your browser, then reload. If this device does not support WebGL, try another modern browser.</p><button class="primary" onclick="location.reload()">TRY AGAIN</button></div>';
}

// Handle page visibility for multiplayer disconnect
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    console.log("[Main] Page hidden");
    // Could notify lobby of temporary disconnect
  } else {
    console.log("[Main] Page visible");
  }
});

// Handle beforeunload for clean lobby leave
window.addEventListener("beforeunload", () => {
  // Attempt to leave lobby cleanly
  try {
    const game = window.__racer;
    if (game && game.multiplayerActive && game.lobby) {
      // Use sendBeacon for reliable leave on page close
      // For now, rely on presence and last_seen_at
      console.log("[Main] Page unloading, multiplayer active");
    }
  } catch {}
});
