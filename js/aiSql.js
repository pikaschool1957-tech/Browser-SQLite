const DEFAULT_GPU_MODEL_ID = "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC";
const DEFAULT_CPU_MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";

const WEBLLM_ESM_URL = "https://esm.run/@mlc-ai/web-llm";
const TRANSFORMERS_ESM_URL = "https://esm.run/@huggingface/transformers";

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function stripSqlFences(rawText) {
  if (!rawText) return "";
  return rawText
    .replace(/^```(?:sql|sqlite)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function buildSchemaSnapshot(db) {
  if (!db) return "-- No database loaded.";

  const tablesRes = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  );
  const tableNames =
    tablesRes.length > 0 && tablesRes[0].values
      ? tablesRes[0].values.map((r) => String(r[0]))
      : [];

  if (tableNames.length === 0) {
    return "-- Database currently has no user tables.";
  }

  return tableNames
    .map((tableName) => {
      const pragmaRes = db.exec(`PRAGMA table_info(${quoteIdent(tableName)});`);
      const cols =
        pragmaRes.length > 0 && pragmaRes[0].values
          ? pragmaRes[0].values.map((colRow) => {
              const colName = colRow[1];
              const colType = colRow[2] || "ANY";
              const notNull = colRow[3] ? " NOT NULL" : "";
              const isPk = colRow[5] ? " PRIMARY KEY" : "";
              return `  ${colName} ${colType}${notNull}${isPk}`;
            })
          : [];

      return `CREATE TABLE ${tableName} (\n${cols.join(",\n")}\n);`;
    })
    .join("\n\n");
}

function createAiSqlAssistant({
  deviceSelectEl,
  loadBtnEl,
  modelSelectEl,
  promptInputEl,
  generateBtnEl,
  sqlInputEl,
  getActiveTable,
  store,
  status,
  defaultGpuModel = DEFAULT_GPU_MODEL_ID,
  defaultCpuModel = DEFAULT_CPU_MODEL_ID,
}) {
  let state = "idle"; // idle | loading | ready | generating | error
  let activeBackend = null; // null | { mode: "gpu" | "cpu", modelId: string, engine?: any, generator?: any }

  function getSelectedMode() {
    const val = (deviceSelectEl?.value || "gpu").toLowerCase();
    return val === "cpu" ? "cpu" : "gpu";
  }

  function getSelectedModelId(mode = getSelectedMode()) {
    const customOrSelected = (modelSelectEl?.value || "").trim();
    if (customOrSelected) return customOrSelected;
    return mode === "cpu" ? defaultCpuModel : defaultGpuModel;
  }

  function isCurrentBackendReady() {
    const mode = getSelectedMode();
    const modelId = getSelectedModelId(mode);
    return (
      state === "ready" &&
      activeBackend &&
      activeBackend.mode === mode &&
      activeBackend.modelId === modelId
    );
  }

  function setUiState(nextState) {
    state = nextState;
    const isBusy = state === "loading" || state === "generating";
    const readyForCurrent = isCurrentBackendReady();

    if (deviceSelectEl) {
      deviceSelectEl.disabled = isBusy;
    }

    if (modelSelectEl) {
      modelSelectEl.disabled = isBusy;
    }

    if (loadBtnEl) {
      loadBtnEl.disabled = isBusy;
      if (state === "loading") {
        loadBtnEl.textContent = "Loading Model...";
      } else if (readyForCurrent) {
        loadBtnEl.textContent = "Reload Model";
      } else {
        loadBtnEl.textContent = `Load AI Model (${getSelectedMode().toUpperCase()})`;
      }
    }

    if (promptInputEl) {
      promptInputEl.disabled = !readyForCurrent || isBusy;
    }

    if (generateBtnEl) {
      generateBtnEl.disabled = !readyForCurrent || isBusy;
      generateBtnEl.textContent =
        state === "generating" ? "Generating SQL..." : "Generate SQL";
    }
  }

  async function initGpuEngine(modelId) {
    if (!navigator.gpu) {
      throw new Error(
        "WebGPU is not available on this device/browser. Switch mode to CPU or use a WebGPU-enabled browser."
      );
    }

    let lastLoggedPct = -1;
    const webllm = await import(WEBLLM_ESM_URL);
    if (typeof webllm.CreateMLCEngine !== "function") {
      throw new Error("CreateMLCEngine export not found in WebLLM module.");
    }

    const initProgressCallback = (report) => {
      const text = report?.text || "Initializing GPU model...";
      const progress =
        typeof report?.progress === "number"
          ? Math.round(report.progress * 100)
          : null;

      if (progress !== null) {
        if (progress !== lastLoggedPct && (progress % 15 === 0 || progress === 100)) {
          lastLoggedPct = progress;
          status.info(`[GPU Model ${progress}%] ${text}`);
        }
      } else {
        status.info(`[GPU Model] ${text}`);
      }
    };

    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback,
    });

    return { mode: "gpu", modelId, engine };
  }

  async function initCpuEngine(modelId) {
    let lastLoggedPct = -1;
    const transformers = await import(TRANSFORMERS_ESM_URL);

    if (typeof transformers.pipeline !== "function") {
      throw new Error("pipeline export not found in Transformers.js module.");
    }

    if (transformers.env) {
      transformers.env.allowLocalModels = false;
      if (transformers.env.backends?.onnx?.wasm) {
        transformers.env.backends.onnx.wasm.numThreads = Math.min(
          navigator.hardwareConcurrency || 2,
          4
        );
      }
    }

    const progress_callback = (info) => {
      if (typeof info?.progress === "number") {
        const pct = Math.round(info.progress);
        if (pct !== lastLoggedPct && (pct % 20 === 0 || pct === 100)) {
          lastLoggedPct = pct;
          const fileLabel = info.file ? ` (${info.file})` : "";
          status.info(`[CPU Model ${pct}%] Downloading weights${fileLabel}...`);
        }
      } else if (info?.status) {
        status.info(`[CPU Model] ${info.status}`);
      }
    };

    const generator = await transformers.pipeline("text-generation", modelId, {
      device: "wasm",
      dtype: "q4",
      progress_callback,
    });

    return { mode: "cpu", modelId, generator };
  }

  async function loadModel() {
    if (state === "loading" || state === "generating") return;

    const mode = getSelectedMode();
    const modelId = getSelectedModelId(mode);

    setUiState("loading");
    status.info(
      `Loading ${mode.toUpperCase()} model "${modelId}" (no API key required)...`
    );

    try {
      activeBackend = null;
      const nextBackend =
        mode === "gpu"
          ? await initGpuEngine(modelId)
          : await initCpuEngine(modelId);

      activeBackend = nextBackend;
      setUiState("ready");
      status.success(
        `${mode.toUpperCase()} AI SQL model "${modelId}" is ready.`
      );
    } catch (err) {
      activeBackend = null;
      setUiState("error");
      status.error(
        `Failed to load ${mode.toUpperCase()} model "${modelId}": ${err.message}`
      );
    }
  }

  async function runInference(systemPrompt, userPrompt) {
    if (!activeBackend) {
      throw new Error("No AI model backend loaded.");
    }

    if (activeBackend.mode === "gpu") {
      const reply = await activeBackend.engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 256,
      });
      return reply?.choices?.[0]?.message?.content || "";
    }

    const formattedPrompt =
      `<|im_start|>system\n${systemPrompt}<|im_end|>\n` +
      `<|im_start|>user\n${userPrompt}<|im_end|>\n` +
      `<|im_start|>assistant\n`;

    const outputs = await activeBackend.generator(formattedPrompt, {
      max_new_tokens: 180,
      do_sample: false,
      return_full_text: false,
    });

    const first = Array.isArray(outputs) ? outputs[0] : outputs;
    return first?.generated_text || "";
  }

  async function generateSql() {
    if (!isCurrentBackendReady()) {
      status.error(
        `Load the selected ${getSelectedMode().toUpperCase()} AI model before generating SQL.`
      );
      return;
    }

    if (!store || !store.db) {
      status.error("SQLite database is not initialized yet.");
      return;
    }

    const promptText = (promptInputEl?.value || "").trim();
    if (!promptText) {
      status.error("Describe the SQL query you want in plain English.");
      return;
    }

    const schemaSql = buildSchemaSnapshot(store.db);
    const activeTable =
      typeof getActiveTable === "function" ? getActiveTable() : "";

    const systemPrompt = [
      "You are a SQLite SQL generator.",
      "Return ONLY a single valid SQLite SQL statement with no markdown fences and no explanation.",
      "Use only the tables and columns defined in the provided schema.",
      "Prefer SELECT queries unless the user explicitly asks to insert, update, delete, or alter schema.",
    ].join(" ");

    const userPrompt = [
      "Database Schema:",
      schemaSql,
      activeTable ? `Currently selected table hint: ${activeTable}` : "",
      `Request: ${promptText}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    setUiState("generating");
    const start = performance.now();
    status.info(
      `Generating SQL on ${activeBackend.mode.toUpperCase()} from live schema...`
    );

    try {
      const rawContent = await runInference(systemPrompt, userPrompt);
      const sqlDraft = stripSqlFences(rawContent);
      const elapsedMs = (performance.now() - start).toFixed(0);

      if (!sqlDraft) {
        throw new Error("Model returned an empty SQL response.");
      }

      if (sqlInputEl) {
        sqlInputEl.value = sqlDraft;
        sqlInputEl.focus();
      }

      setUiState("ready");
      status.success(
        `Drafted SQL via ${activeBackend.mode.toUpperCase()} in ${elapsedMs} ms. Review and click Run SQL.`
      );
    } catch (err) {
      const elapsedMs = (performance.now() - start).toFixed(0);
      setUiState("ready");
      status.error(`SQL generation failed after ${elapsedMs} ms: ${err.message}`);
    }
  }

  deviceSelectEl?.addEventListener("change", () => {
    if (state === "loading" || state === "generating") return;
    setUiState(activeBackend ? "ready" : "idle");
    status.info(
      `Selected compute mode: ${getSelectedMode().toUpperCase()}. Click Load AI Model to initialize.`
    );
  });

  modelSelectEl?.addEventListener("change", () => {
    if (state === "loading" || state === "generating") return;
    setUiState(activeBackend ? "ready" : "idle");
  });

  setUiState("idle");

  loadBtnEl?.addEventListener("click", loadModel);
  generateBtnEl?.addEventListener("click", generateSql);
  promptInputEl?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      generateSql();
    }
  });

  return {
    loadModel,
    generateSql,
    getState: () => state,
    getMode: getSelectedMode,
  };
}

window.createAiSqlAssistant = createAiSqlAssistant;