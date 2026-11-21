import { SqliteStore } from "./db.js";
import { StatusController } from "./status.js";

const store = new SqliteStore();
const renderGrid = window.renderGrid;

const els = {
  newDbBtn: document.getElementById("newDbBtn"),
  loadDbBtn: document.getElementById("loadDbBtn"),
  fileInput: document.getElementById("fileInput"),
  saveDbBtn: document.getElementById("saveDbBtn"),
  tableSelect: document.getElementById("tableSelect"),
  toggleCreateTableBtn: document.getElementById("toggleCreateTableBtn"),
  createTablePanel: document.getElementById("createTablePanel"),
  newTableName: document.getElementById("newTableName"),
  newColDefs: document.getElementById("newColDefs"),
  createTableSubmitBtn: document.getElementById("createTableSubmitBtn"),
  toggleInsertRowBtn: document.getElementById("toggleInsertRowBtn"),
  insertRowPanel: document.getElementById("insertRowPanel"),
  insertFields: document.getElementById("insertFields"),
  insertRowSubmitBtn: document.getElementById("insertRowSubmitBtn"),
  toggleQueryConsoleBtn: document.getElementById("toggleQueryConsoleBtn"),
  queryConsolePanel: document.getElementById("queryConsolePanel"),
  sqlInput: document.getElementById("sqlInput"),
  runSqlBtn: document.getElementById("runSqlBtn"),
  clearSqlBtn: document.getElementById("clearSqlBtn"),
  sqlSnippetSelect: document.getElementById("sqlSnippetSelect"),
  queryResultDisplay: document.getElementById("queryResultDisplay"),
  dataDisplay: document.getElementById("dataDisplay"),
  statusBar: document.getElementById("statusBar"),
  statusLog: document.getElementById("statusLog"),
};

const status = new StatusController(els.statusBar, els.statusLog);

// Replay any boot errors captured before this module finished loading
if (Array.isArray(window.__bootErrors) && window.__bootErrors.length > 0) {
  window.__bootErrors.forEach((errMsg) => status.error(errMsg));
}

function getActiveTable() {
  return els.tableSelect?.value || "";
}

function buildInsertForm() {
  const tableName = getActiveTable();
  if (!els.insertFields) return;

  els.insertFields.innerHTML = "";
  if (!tableName) {
    els.insertRowPanel?.classList.add("hidden");
    return;
  }

  const cols = store.getColumns(tableName);
  for (const col of cols) {
    const input = document.createElement("input");
    input.dataset.col = col.name;
    input.placeholder = `${col.name} (${col.type || "ANY"})`;
    els.insertFields.appendChild(input);
  }
}

function syncInsertFormForActiveTable() {
  const tableName = getActiveTable();
  if (!tableName) {
    if (els.insertFields) els.insertFields.innerHTML = "";
    els.insertRowPanel?.classList.add("hidden");
    return;
  }
  buildInsertForm();
}

function refreshTableList(preferredTable = null) {
  if (!els.tableSelect || !els.dataDisplay) return;

  const tables = store.getTables();
  els.tableSelect.innerHTML = "";

  if (tables.length === 0) {
    els.dataDisplay.innerHTML =
      "<p>No tables in database. Click <b>+ New Table</b> to create one.</p>";
    syncInsertFormForActiveTable();
    status.info("Database has 0 user tables.");
    return;
  }

  for (const name of tables) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    els.tableSelect.appendChild(opt);
  }

  els.tableSelect.value =
    preferredTable && tables.includes(preferredTable) ? preferredTable : tables[0];

  syncInsertFormForActiveTable();
  renderActiveTable();
}

function renderActiveTable() {
  const tableName = getActiveTable();
  if (!tableName || !els.dataDisplay) return;

  if (typeof renderGrid !== "function") {
    status.error("renderGrid helper is not loaded. Check ./js/gridView.js.");
    return;
  }

  try {
    status.info(`Loading rows from table "${tableName}"...`);
    const { columns, rows } = store.fetchRows(tableName);

    renderGrid(els.dataDisplay, {
      columns,
      rows,
      onUpdateCell: (rowid, col, val) => {
        try {
          store.updateCell(tableName, rowid, col, val);
          status.success(`Updated ${tableName}.${col} (rowid ${rowid}).`);
        } catch (err) {
          status.error(`Update failed on ${tableName}.${col}: ${err.message}`);
          renderActiveTable();
        }
      },
      onDeleteRow: (rowid) => {
        try {
          store.deleteRow(tableName, rowid);
          renderActiveTable();
          status.success(`Deleted rowid ${rowid} from "${tableName}".`);
        } catch (err) {
          status.error(`Delete failed on "${tableName}": ${err.message}`);
        }
      },
    });

    status.info(
      `Displaying "${tableName}" (${rows.length} row(s), ${columns.length} column(s)).`
    );
  } catch (err) {
    status.error(`Failed to render table "${tableName}": ${err.message}`);
  }
}

const queryConsole =
  typeof window.createQueryConsole === "function"
    ? window.createQueryConsole({
        panelEl: els.queryConsolePanel,
        textareaEl: els.sqlInput,
        runBtnEl: els.runSqlBtn,
        clearBtnEl: els.clearSqlBtn,
        snippetSelectEl: els.sqlSnippetSelect,
        outputEl: els.queryResultDisplay,
        store,
        status,
        onSchemaChange: () => {
          const current = getActiveTable();
          refreshTableList(current || null);
        },
      })
    : null;

function bindEvents() {
  els.newDbBtn?.addEventListener("click", () => {
    try {
      status.info("Creating a fresh sample database...");
      store.createNew();
      if (els.queryResultDisplay) els.queryResultDisplay.innerHTML = "";
      refreshTableList();
      status.success("Created new sample database.");
    } catch (err) {
      status.error(`Failed to create database: ${err.message}`);
    }
  });

  els.loadDbBtn?.addEventListener("click", () => {
    status.info("Opening file picker for .sqlite file...");
    els.fileInput?.click();
  });

  els.fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    status.info(`Reading "${file.name}" (${file.size} bytes)...`);
    const reader = new FileReader();

    reader.onload = () => {
      try {
        store.loadBytes(new Uint8Array(reader.result));
        if (els.queryResultDisplay) els.queryResultDisplay.innerHTML = "";
        refreshTableList();
        status.success(`Loaded database file "${file.name}".`);
      } catch (err) {
        status.error(`Could not load "${file.name}": ${err.message}`);
      }
    };

    reader.onerror = () => {
      status.error(`FileReader error while reading "${file.name}".`);
    };

    reader.readAsArrayBuffer(file);
    e.target.value = "";
  });

  els.saveDbBtn?.addEventListener("click", () => {
    try {
      status.info("Exporting SQLite binary bytes...");
      const bytes = store.exportBytes();
      const blob = new Blob([bytes], { type: "application/x-sqlite3" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "database.sqlite";
      link.click();
      URL.revokeObjectURL(url);
      status.success(`Exported database.sqlite (${bytes.byteLength} bytes).`);
    } catch (err) {
      status.error(`Save failed: ${err.message}`);
    }
  });

  els.tableSelect?.addEventListener("change", () => {
    const active = getActiveTable();
    status.info(`Switched active table to "${active}".`);
    syncInsertFormForActiveTable();
    renderActiveTable();
  });

  els.toggleCreateTableBtn?.addEventListener("click", () => {
    if (!els.createTablePanel) return;
    els.createTablePanel.classList.toggle("hidden");
    const isHidden = els.createTablePanel.classList.contains("hidden");
    status.info(
      isHidden ? "Closed Create Table form." : "Opened Create Table form."
    );
  });

  els.createTableSubmitBtn?.addEventListener("click", () => {
    const name = els.newTableName?.value.trim() || "";
    const colsSql = els.newColDefs?.value.trim() || "";

    if (!name || !colsSql) {
      status.error("Enter both a table name and column definitions.");
      return;
    }

    try {
      status.info(`Creating table "${name}"...`);
      store.createTable(name, colsSql);
      if (els.newTableName) els.newTableName.value = "";
      if (els.newColDefs) els.newColDefs.value = "";
      els.createTablePanel?.classList.add("hidden");
      refreshTableList(name);
      status.success(`Created table "${name}".`);
    } catch (err) {
      status.error(`Create table failed: ${err.message}`);
    }
  });

  els.toggleInsertRowBtn?.addEventListener("click", () => {
    if (!els.insertRowPanel) return;
    const active = getActiveTable();
    if (!active) {
      status.error("Select or create a table before inserting a row.");
      return;
    }

    els.insertRowPanel.classList.toggle("hidden");
    const isHidden = els.insertRowPanel.classList.contains("hidden");
    if (!isHidden) {
      buildInsertForm();
      status.info(`Opened Insert Row form for "${active}".`);
    } else {
      status.info("Closed Insert Row form.");
    }
  });

  els.insertRowSubmitBtn?.addEventListener("click", () => {
    const tableName = getActiveTable();
    if (!tableName || !els.insertFields) return;

    const payload = {};
    els.insertFields.querySelectorAll("input").forEach((input) => {
      payload[input.dataset.col] = input.value;
    });

    try {
      status.info(`Inserting row into "${tableName}"...`);
      store.insertRow(tableName, payload);
      els.insertFields.querySelectorAll("input").forEach((input) => {
        input.value = "";
      });
      renderActiveTable();
      status.success(`Inserted new row into "${tableName}".`);
    } catch (err) {
      status.error(`Insert failed: ${err.message}`);
    }
  });

  els.toggleQueryConsoleBtn?.addEventListener("click", () => {
    if (!queryConsole) {
      status.error(
        "Query console helper is not loaded. Check ./js/queryConsole.js."
      );
      return;
    }
    queryConsole.toggle();
    status.info(
      queryConsole.isHidden()
        ? "Closed SQL Query Console."
        : "Opened SQL Query Console."
    );
  });
}

async function boot() {
  bindEvents();
  status.info("Starting SQLite store...");

  try {
    await store.init((msg) => status.info(msg));
    refreshTableList();
    status.success(
      "Ready. Click any cell to edit; click Delete to remove a row."
    );
  } catch (err) {
    status.error(`Initialization error: ${err.message}`);
  }
}

boot();
