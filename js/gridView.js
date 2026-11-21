function renderGrid(container, { columns, rows, onUpdateCell, onDeleteRow }) {
  container.innerHTML = "";

  if (!columns.length) {
    container.innerHTML = "<p>No columns found in this table.</p>";
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

  const delTh = document.createElement("th");
  delTh.textContent = "Delete";
  headRow.appendChild(delTh);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const rowid = row[0];
    const tr = document.createElement("tr");

    columns.forEach((col, idx) => {
      const td = document.createElement("td");
      const val = row[idx + 1];
      td.textContent = val === null ? "" : String(val);
      td.contentEditable = "true";

      td.addEventListener("blur", () => {
        const nextVal = td.textContent.trim() === "" ? null : td.textContent;
        if (String(val ?? "") !== String(nextVal ?? "")) {
          onUpdateCell(rowid, col, nextVal);
        }
      });

      tr.appendChild(td);
    });

    const delTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Delete";
    btn.addEventListener("click", () => onDeleteRow(rowid));
    delTd.appendChild(btn);
    tr.appendChild(delTd);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

window.renderGrid = renderGrid;