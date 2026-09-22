export class Input {
  constructor(onAction) {
    this.keys = new Set();
    this.touch = new Set();
    this.onAction = onAction;
    this.active = false;
    window.addEventListener("keydown", (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      const k = e.code;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
          k,
        ) &&
        this.active
      )
        e.preventDefault();
      if (!e.repeat) {
        if (k === "Escape" || k === "KeyP") onAction("pause");
        if ((k === "KeyE" || k === "KeyX") && this.active) onAction("item");
        if (k === "KeyR" && this.active) onAction("restart");
      }
      this.keys.add(k);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.clear();
      onAction("blur");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.clear();
        onAction("blur");
      }
    });
  }
  bindTouch() {
    document.querySelectorAll("[data-control]").forEach((el) => {
      const key = el.dataset.control;
      const start = (e) => {
        if (e.cancelable) e.preventDefault();
        if (key === "item") {
          this.onAction("item");
          return;
        }
        this.touch.add(key);
        el.classList.add("held");
      };
      const end = (e) => {
        if (e.cancelable) e.preventDefault();
        this.touch.delete(key);
        el.classList.remove("held");
      };
      el.addEventListener("touchstart", start, { passive: false });
      el.addEventListener("touchend", end, { passive: false });
      el.addEventListener("touchcancel", end, { passive: false });
      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "touch") return;
        el.setPointerCapture(e.pointerId);
        start(e);
      });
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
    });
  }
  clear() {
    this.keys.clear();
    this.touch.clear();
    document
      .querySelectorAll(".held")
      .forEach((el) => el.classList.remove("held"));
  }
  has(...keys) {
    return keys.some((k) => this.keys.has(k) || this.touch.has(k));
  }
  get controls() {
    return {
      throttle: this.has("KeyW", "ArrowUp", "gas") ? 1 : 0,
      brake: this.has("KeyS", "ArrowDown", "brake") ? 1 : 0,
      steer:
        (this.has("KeyA", "ArrowLeft", "left") ? 1 : 0) -
        (this.has("KeyD", "ArrowRight", "right") ? 1 : 0),
      drift: this.has("Space", "drift"),
      boost: this.has("ShiftLeft", "ShiftRight", "boost"),
    };
  }
}
