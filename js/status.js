export class StatusController {
  constructor(barEl, logEl = null, maxEntries = 40) {
    this.barEl = barEl;
    this.logEl = logEl;
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  set(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    if (this.barEl) {
      this.barEl.textContent = `[${timestamp}] ${message}`;
      this.barEl.className = type === "info" ? "" : type;
    }

    this.entries.unshift({ timestamp, message, type });
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }

    this.renderLog();
  }

  info(message) {
    this.set(message, "info");
  }

  success(message) {
    this.set(message, "success");
  }

  error(message) {
    this.set(message, "error");
  }

  renderLog() {
    if (!this.logEl) return;
    this.logEl.innerHTML = this.entries
      .map(
        (item) =>
          `<div class="log-item log-${item.type}"><span class="log-time">[${item.timestamp}]</span> ${escapeHtml(item.message)}</div>`
      )
      .join("");
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}