(() => {
  const DEFAULTS = {
    apiUrl: "http://localhost:8080",
    workspace: "aligent",
  };

  const VALID_INTERVALS = ["auto", "hour", "day", "week", "month", "year"];
  const PREFS_KEY = "monocle-alt-frontend.prefs";

  const METRICS = [
    {
      id: "first_review_to_last_approval_mean_time_excluding_bots",
      title: "1st review to last approval — mean time (excluding bots)",
      kind: "duration",
      summaryLabel: "Mean (range)",
      colour: "imagination",
      panelEl: () => document.getElementById("panel-mean-time"),
      summaryEl: () => document.getElementById("summary-mean-time"),
      chartEl: () => document.getElementById("chart-mean-time"),
      tableBodyEl: () => document.getElementById("tbody-mean-time"),
      tableAvgEl: () => document.getElementById("tavg-mean-time"),
    },
    {
      id: "first_review_to_last_approval_mean_time_excluding_bots_min_5m",
      title: "1st review to last approval — mean time (excluding bots, ignoring <5m)",
      kind: "duration",
      summaryLabel: "Mean (range)",
      colour: "depth",
      panelEl: () => document.getElementById("panel-mean-time-min5m"),
      summaryEl: () => document.getElementById("summary-mean-time-min5m"),
      chartEl: () => document.getElementById("chart-mean-time-min5m"),
      tableBodyEl: () => document.getElementById("tbody-mean-time-min5m"),
      tableAvgEl: () => document.getElementById("tavg-mean-time-min5m"),
    },
    {
      id: "first_review_to_last_approval_median_time_excluding_bots_min_5m",
      title: "1st review to last approval — median time (excluding bots, ignoring <5m)",
      kind: "duration",
      summaryLabel: "Median (range)",
      colour: "imagination-40",
      panelEl: () => document.getElementById("panel-median-time-min5m"),
      summaryEl: () => document.getElementById("summary-median-time-min5m"),
      chartEl: () => document.getElementById("chart-median-time-min5m"),
      tableBodyEl: () => document.getElementById("tbody-median-time-min5m"),
      tableAvgEl: () => document.getElementById("tavg-median-time-min5m"),
    },
    {
      id: "single_approve_percentage_excluding_bots",
      title: "Single-approve PR percentage (excluding bots)",
      kind: "percentage",
      summaryLabel: "Range %",
      colour: "depth-80",
      panelEl: () => document.getElementById("panel-single-approve"),
      summaryEl: () => document.getElementById("summary-single-approve"),
      chartEl: () => document.getElementById("chart-single-approve"),
      tableBodyEl: () => document.getElementById("tbody-single-approve"),
      tableAvgEl: () => document.getElementById("tavg-single-approve"),
    },
  ];

  const COLOURS = {
    imagination: { border: "#DA61F1", fill: "rgba(218, 97, 241, 0.18)" },
    "imagination-40": { border: "#B83CCB", fill: "rgba(240, 192, 249, 0.45)" },
    depth: { border: "#010D2D", fill: "rgba(1, 13, 45, 0.14)" },
    "depth-80": { border: "#343D57", fill: "rgba(52, 61, 87, 0.16)" },
  };

  const charts = {};

  /* ------------------------- config persistence ------------------------- */

  function loadConfig() {
    try {
      const raw = localStorage.getItem("monocle-alt-frontend.config");
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem("monocle-alt-frontend.config", JSON.stringify(cfg));
  }

  /* ------------------------ date / interval helpers ---------------------- */

  function todayIso() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  function isoMonthsAgo(n) {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 10);
  }

  function presetToDate(preset) {
    switch (preset) {
      case "7d": return isoDaysAgo(7);
      case "30d": return isoDaysAgo(30);
      case "3m": return isoMonthsAgo(3);
      case "6m": return isoMonthsAgo(6);
      case "1y": return isoMonthsAgo(12);
      default: return null;
    }
  }

  function daysBetween(fromIso) {
    const from = new Date(fromIso + "T00:00:00Z");
    const now = new Date();
    return Math.max(1, Math.round((now - from) / 86400000));
  }

  function autoInterval(days) {
    if (days <= 2) return "hour";
    if (days <= 60) return "day";
    if (days <= 365) return "week";
    return "month";
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function savePrefs(p) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  }

  /* ------------------------------ fetching ------------------------------ */

  async function fetchMetric(cfg, metricId, fromDate, options) {
    const body = {
      index: cfg.workspace,
      username: "",
      query: `from:${fromDate}`,
      metric: metricId,
      options,
    };
    const resp = await fetch(`${cfg.apiUrl.replace(/\/+$/, "")}/api/2/metric/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
    }
    if (data && data.error) {
      throw new Error(`API error: ${data.error}`);
    }
    return data;
  }

  /* ------------------------- response interpretation -------------------- */

  function extractCompute(metric, resp) {
    if (metric.kind === "duration") {
      if (resp.duration_value && typeof resp.duration_value.value === "number") {
        return resp.duration_value.value;
      }
    } else if (metric.kind === "percentage") {
      if (typeof resp.float_value === "number") return resp.float_value;
    }
    throw new Error(`Unexpected response shape for ${metric.id}: ${JSON.stringify(resp).slice(0, 200)}`);
  }

  function extractTrend(metric, resp) {
    if (metric.kind === "duration") {
      const histo = resp.histo_duration && resp.histo_duration.histo;
      if (Array.isArray(histo)) return histo;
    } else if (metric.kind === "percentage") {
      const histo = resp.histo_float && resp.histo_float.histo;
      if (Array.isArray(histo)) return histo;
    }
    throw new Error(`Unexpected trend shape for ${metric.id}: ${JSON.stringify(resp).slice(0, 200)}`);
  }

  /* ------------------------------ formatting ---------------------------- */

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return "—";
    const days = seconds / 86400;
    if (days >= 1) return `${days.toFixed(1)} d`;
    const hours = seconds / 3600;
    if (hours >= 1) return `${hours.toFixed(1)} h`;
    return `${Math.round(seconds)} s`;
  }

  function formatPercentage(v) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    return `${v.toFixed(1)}%`;
  }

  function formatValue(metric, raw) {
    return metric.kind === "duration" ? formatDuration(raw) : formatPercentage(raw);
  }

  /* ------------------------------ rendering ----------------------------- */

  function average(values) {
    const nums = values.filter((v) => typeof v === "number" && !isNaN(v));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function renderSummary(metric, value) {
    const el = metric.summaryEl();
    el.querySelector(".value").textContent = formatValue(metric, value);
  }

  function renderTable(metric, histo) {
    const tbody = metric.tableBodyEl();
    tbody.innerHTML = "";
    if (!histo.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="2" class="empty">No data in range.</td>`;
      tbody.appendChild(tr);
      metric.tableAvgEl().textContent = "—";
      return;
    }
    for (const bucket of histo) {
      const tr = document.createElement("tr");
      const dateTd = document.createElement("td");
      dateTd.textContent = bucket.date;
      const valTd = document.createElement("td");
      valTd.className = "numeric";
      valTd.textContent = formatValue(metric, bucket.count);
      tr.appendChild(dateTd);
      tr.appendChild(valTd);
      tbody.appendChild(tr);
    }
    const avg = average(histo.map((b) => b.count));
    metric.tableAvgEl().textContent = formatValue(metric, avg);
  }

  function renderChart(metric, histo) {
    const canvas = metric.chartEl();
    const ctx = canvas.getContext("2d");
    const colour = COLOURS[metric.colour];
    const labels = histo.map((b) => b.date);
    const data = histo.map((b) =>
      metric.kind === "duration" ? b.count / 86400 : b.count,
    );
    const datasetLabel =
      metric.kind === "duration" ? "Mean time (days)" : "Single-approve %";

    if (charts[metric.id]) {
      charts[metric.id].destroy();
    }

    charts[metric.id] = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: datasetLabel,
            data,
            borderColor: colour.border,
            backgroundColor: colour.fill,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                metric.kind === "duration"
                  ? `${ctx.parsed.y.toFixed(2)} d`
                  : `${ctx.parsed.y.toFixed(1)}%`,
            },
          },
        },
        scales: {
          y: {
            ...(metric.kind === "percentage"
              ? { min: 0, max: 100 }
              : { beginAtZero: true }),
            ticks: {
              callback: (v) =>
                metric.kind === "duration" ? `${v} d` : `${v}%`,
            },
          },
          x: { ticks: { autoSkip: true, maxRotation: 0 } },
        },
      },
    });
  }

  /* ----------------------------- error banner --------------------------- */

  function showError(msg) {
    const banner = document.getElementById("error-banner");
    banner.textContent = msg;
    banner.classList.remove("hidden");
  }

  function clearError() {
    const banner = document.getElementById("error-banner");
    banner.textContent = "";
    banner.classList.add("hidden");
  }

  /* ------------------------------- refresh ------------------------------ */

  let inflight = 0;

  async function refresh() {
    const cfg = loadConfig();
    const fromDate = document.getElementById("from-date").value;
    if (!fromDate) {
      showError("Pick a from-date.");
      return;
    }
    const intervalChoice = document.getElementById("interval").value;
    const days = daysBetween(fromDate);
    const interval =
      intervalChoice === "auto" ? autoInterval(days) : intervalChoice;

    clearError();
    inflight++;
    document.body.classList.add("loading");

    const requests = METRICS.flatMap((m) => [
      fetchMetric(cfg, m.id, fromDate, { compute: { void: "" } }).then(
        (resp) => ({ kind: "compute", metric: m, resp }),
        (err) => ({ kind: "compute", metric: m, err }),
      ),
      fetchMetric(cfg, m.id, fromDate, { trend: { interval } }).then(
        (resp) => ({ kind: "trend", metric: m, resp }),
        (err) => ({ kind: "trend", metric: m, err }),
      ),
    ]);

    const results = await Promise.all(requests);
    inflight--;
    if (inflight === 0) document.body.classList.remove("loading");

    const errors = [];
    for (const r of results) {
      if (r.err) {
        errors.push(`${r.metric.id} (${r.kind}): ${r.err.message}`);
        continue;
      }
      try {
        if (r.kind === "compute") {
          renderSummary(r.metric, extractCompute(r.metric, r.resp));
        } else {
          const histo = extractTrend(r.metric, r.resp);
          renderChart(r.metric, histo);
          renderTable(r.metric, histo);
        }
      } catch (e) {
        errors.push(`${r.metric.id} (${r.kind}): ${e.message}`);
      }
    }

    if (errors.length) showError(errors.join("\n"));
  }

  const debouncedRefresh = (() => {
    let t;
    return () => {
      clearTimeout(t);
      t = setTimeout(refresh, 200);
    };
  })();

  /* ------------------------------ wiring -------------------------------- */

  function setActivePreset(preset) {
    document.querySelectorAll("button.preset").forEach((b) => {
      b.classList.toggle("active", b.dataset.preset === preset);
    });
  }

  function clearActivePreset() {
    document.querySelectorAll("button.preset").forEach((b) =>
      b.classList.remove("active"),
    );
  }

  function init() {
    const cfg = loadConfig();
    document.getElementById("api-url").value = cfg.apiUrl;
    document.getElementById("workspace").value = cfg.workspace;

    const fromInput = document.getElementById("from-date");
    fromInput.value = isoDaysAgo(30);
    fromInput.max = todayIso();
    setActivePreset("30d");

    const intervalSelect = document.getElementById("interval");
    const prefs = loadPrefs();
    if (VALID_INTERVALS.includes(prefs.interval)) {
      intervalSelect.value = prefs.interval;
    }
    intervalSelect.addEventListener("change", () => {
      savePrefs({ ...loadPrefs(), interval: intervalSelect.value });
      refresh();
    });

    document.getElementById("settings-save").addEventListener("click", () => {
      const next = {
        apiUrl: document.getElementById("api-url").value.trim() || DEFAULTS.apiUrl,
        workspace:
          document.getElementById("workspace").value.trim() || DEFAULTS.workspace,
      };
      saveConfig(next);
      refresh();
    });

    document.querySelectorAll("button.preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.dataset.preset;
        const date = presetToDate(preset);
        if (!date) return;
        fromInput.value = date;
        setActivePreset(preset);
        refresh();
      });
    });

    fromInput.addEventListener("change", () => {
      clearActivePreset();
      debouncedRefresh();
    });

    document
      .getElementById("refresh-btn")
      .addEventListener("click", () => refresh());

    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
