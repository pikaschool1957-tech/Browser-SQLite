const CDN_BASE = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/";

export class SqliteStore {
  constructor() {
    this.SQL = null;
    this.db = null;
  }

  async init(onStatus = () => {}) {
    if (!this.SQL) {
      onStatus("Checking for sql.js global...");
      if (typeof window.initSqlJs !== "function") {
        throw new Error(
          "sql-wasm.js was not loaded. Check network/CDN or local script path."
        );
      }

      onStatus("Initializing SQLite WebAssembly engine...");
      this.SQL = await window.initSqlJs({
        locateFile: (file) => {
          const url = `${CDN_BASE}${file}`;
          onStatus(`Fetching WASM file: ${file}...`);
          return url;
        },
      });
      onStatus("SQLite WebAssembly engine ready.");
    }

    onStatus("Creating initial database in memory...");
    this.createNew();
    onStatus("Initial database ready with sample table 'notes'.");
  }

  createNew() {
    if (this.db) this.db.close();
    this.db = new this.SQL.Database();
    this.db.run(`
      CREATE TABLE notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT
      );
      INSERT INTO notes (title, body) VALUES
        ('First Note', 'Hello from local SQLite!'),
        ('Idea', 'Add natural language SQL later.');
    `);
  }

  loadBytes(uint8Array) {
    if (this.db) this.db.close();
    this.db = new this.SQL.Database(uint8Array);
  }

  exportBytes() {
    return this.db.export();
  }

  getTables() {
    const res = this.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    );
    return res.length ? res[0].values.map((r) => r[0]) : [];
  }

  getColumns(tableName) {
    const info = this.db.exec(`PRAGMA table_info("${tableName}");`);
    return info.length
      ? info[0].values.map((r) => ({
          name: r[1],
          type: r[2],
          notNull: r[3] === 1,
        }))
      : [];
  }

  createTable(tableName, colsSql) {
    this.db.run(`CREATE TABLE "${tableName}" (${colsSql});`);
  }

  fetchRows(tableName) {
    const columns = this.getColumns(tableName).map((c) => c.name);
    const res = this.db.exec(`SELECT rowid AS __rowid__, * FROM "${tableName}";`);
    const rows = res.length ? res[0].values : [];
    return { columns, rows };
  }

  insertRow(tableName, valuesByCol) {
    const cols = Object.keys(valuesByCol).filter((k) => valuesByCol[k] !== "");
    if (cols.length === 0) {
      this.db.run(`INSERT INTO "${tableName}" DEFAULT VALUES;`);
      return;
    }
    const placeholders = cols.map(() => "?").join(", ");
    const quotedCols = cols.map((c) => `"${c}"`).join(", ");
    const params = cols.map((c) => valuesByCol[c]);
    this.db.run(
      `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders});`,
      params
    );
  }

  updateCell(tableName, rowid, colName, value) {
    this.db.run(
      `UPDATE "${tableName}" SET "${colName}" = ? WHERE rowid = ?;`,
      [value, rowid]
    );
  }

  deleteRow(tableName, rowid) {
    this.db.run(`DELETE FROM "${tableName}" WHERE rowid = ?;`, [rowid]);
  }
}