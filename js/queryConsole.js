function renderReadOnlyGrid(container, { columns, values }) {
  container.innerHTML = "";

  if (!columns || !columns.length) {
    container.innerHTML = "<p>Query completed with no returned columns.</p>";
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  (values || []).forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((_, idx) => {
      const td = document.createElement("td");
      const val = row[idx];
      td.textContent = val === null || val === undefined ? "NULL" : String(val);
      if (val === null || val === undefined) {
        td.style.color = "#64748b";
        td.style.fontStyle = "italic";
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function isSchemaMutation(sql) {
  return /\b(CREATE|DROP|ALTER)\s+(TABLE|VIEW|INDEX|TRIGGER)\b/i.test(sql);
}

function createQueryConsole({
  panelEl,
  textareaEl,
  runBtnEl,
  clearBtnEl,
  snippetSelectEl,
  outputEl,
  store,
  status,
  onSchemaChange,
}) {
  const renderResult = window.renderReadOnlyGrid || renderReadOnlyGrid;

  function executeSql() {
    if (!store || !store.db) {
      status.error("SQLite database is not initialized yet.");
      return;
    }

    const sql = (textareaEl?.value || "").trim();
    if (!sql) {
      status.error("Enter a SQL statement before running.");
      return;
    }

    const start = performance.now();
    status.info("Executing SQL query...");

    try {
      const results = store.db.exec(sql);
      const elapsedMs = (performance.now() - start).toFixed(1);
      const rowsModified =
        typeof store.db.getRowsModified === "function"
          ? store.db.getRowsModified()
          : 0;

      if (results && results.length > 0) {
        const lastSet = results[results.length - 1];
        if (outputEl) {
          renderResult(outputEl, lastSet);
        }
        const rowCount = (lastSet.values || []).length;
        const multiNote =
          results.length > 1 ? ` (${results.length} result sets; showing last)` : "";
        status.success(
          `Query returned ${rowCount} row(s) in ${elapsedMs} ms${multiNote}.`
        );
      } else {
        if (outputEl) {
          outputEl.innerHTML = `<p>Statement executed (${rowsModified} row(s) affected in ${elapsedMs} ms).</p>`;
        }
        status.success(
          `SQL executed in ${elapsedMs} ms (${rowsModified} row(s) modified).`
        );
      }

      if (isSchemaMutation(sql) && typeof onSchemaChange === "function") {
        onSchemaChange();
      }
    } catch (err) {
      const elapsedMs = (performance.now() - start).toFixed(1);
      if (outputEl) {
        outputEl.innerHTML = `<p style="color:#991b1b;">SQL Error: ${err.message}</p>`;
      }
      status.error(`SQL failed after ${elapsedMs} ms: ${err.message}`);
    }
  }

  runBtnEl?.addEventListener("click", executeSql);

  clearBtnEl?.addEventListener("click", () => {
    if (textareaEl) textareaEl.value = "";
    if (outputEl) outputEl.innerHTML = "";
    status.info("Cleared SQL query console.");
  });

  snippetSelectEl?.addEventListener("change", () => {
    const snippet = snippetSelectEl.value;
    if (!snippet || !textareaEl) return;
    textareaEl.value = snippet;
    textareaEl.focus();
    snippetSelectEl.value = "";
  });

  textareaEl?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      executeSql();
    }
  });

  return {
    executeSql,
    show: () => panelEl?.classList.remove("hidden"),
    hide: () => panelEl?.classList.add("hidden"),
    toggle: () => panelEl?.classList.toggle("hidden"),
    isHidden: () => panelEl?.classList.contains("hidden") ?? true,
  };
}

window.createQueryConsole = createQueryConsole;