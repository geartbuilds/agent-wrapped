/* Agent Wrapped — browser runtime. Builds the landscape card from a stats
   object, scales it to fit the viewport, handles theme switching, PNG export
   and the X share intent. No dependencies. */
(function () {
  var REPO = "github.com/geartbuilds/agent-wrapped";
  var RUN = "npx github:geartbuilds/agent-wrapped";

  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }
  function fmtUSD(n) {
    if (n >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
    if (n >= 100) return "$" + n.toFixed(0);
    return "$" + n.toFixed(2);
  }
  function fmtTokens(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
    return String(n);
  }
  function hourLabel(h) {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? h + " AM" : (h - 12) + " PM";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function bars(hist, peak) {
    var max = Math.max.apply(null, [1].concat(hist));
    return hist.map(function (v, h) {
      var pct = Math.max(4, Math.round((v / max) * 100));
      return '<div class="' + (h === peak ? "bar2 peak" : "bar2") + '" style="height:' + pct + '%"></div>';
    }).join("");
  }

  function buildCard(s, handle) {
    var a = s.archetype || {};
    var cells = [
      { label: "Sessions", value: fmtInt(s.sessions) },
      { label: "Spent (est.)", value: fmtUSD(s.costUSD) },
      { label: "Tokens", value: fmtTokens(s.tokens.total) },
      { label: "Your prompts", value: fmtInt(s.humanPrompts) },
      { label: "Active days", value: fmtInt(s.activeDays) },
      { label: "Longest streak", value: s.longestStreak + "d" },
    ];
    var cellHtml = cells.map(function (c) {
      return '<div class="cell"><div class="cell-val">' + c.value + '</div><div class="cell-label">' + c.label + '</div></div>';
    }).join("");
    var topFile = s.topFile ? esc(s.topFile.name) + " · " + fmtInt(s.topFile.edits) + " edits" : "—";

    var left =
      '<div class="col">' +
        '<div class="topbar"><span class="brand">AGENT&nbsp;WRAPPED</span><span class="period">' + esc(s.period.label) + '</span>' +
          (s.rankLabel ? '<span class="rankpill">' + esc(s.rankLabel) + '</span>' : '') + '</div>' +
        '<div class="hero"><div class="hero-num">' + fmtInt(s.linesWritten) + '</div>' +
          '<div class="hero-label">lines of code your agent wrote</div></div>' +
        '<div class="archetype"><span class="emoji">' + (a.emoji || "✦") + '</span>' +
          '<div><div class="arche-name">' + esc(a.name || "") + '</div>' +
          '<div class="arche-tier">' + esc(a.tier || "") + ' · peaks at ' + hourLabel(s.peakHour) + '</div></div></div>' +
        (s.roast ? '<div class="roast">“' + esc(s.roast) + '”</div>' : '') +
        '<div class="handle"><span class="dot"></span>' + esc(handle) + '</div>' +
      '</div>';

    var right =
      '<div class="col">' +
        '<div class="grid">' + cellHtml + '</div>' +
        '<div class="histo-wrap">' +
          '<div class="histo-title">WHEN YOU SHIP <span class="histo-peak">busiest at ' + hourLabel(s.peakHour) + '</span></div>' +
          '<div class="histo">' + bars(s.hourHistogram, s.peakHour) + '</div>' +
          '<div class="histo-axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>' +
        '</div>' +
        '<div class="topfile"><span class="tf-label">MOST-EDITED FILE</span><span class="tf-val">' + topFile + '</span></div>' +
      '</div>';

    return '<div class="bg"></div><div class="content">' + left + right + '</div>';
  }

  var current = { stats: null, handle: "@geartbuilds" };

  function fit() {
    var card = document.getElementById("card");
    var stage = document.getElementById("stage");
    if (!card || !stage) return;
    var pad = 130;
    var s = Math.min(1, (window.innerWidth - 32) / 1600, (window.innerHeight - pad) / 900);
    s = Math.max(0.2, s);
    card.style.transform = "scale(" + s + ")";
    stage.style.width = 1600 * s + "px";
    stage.style.height = 900 * s + "px";
  }

  function applyTheme(name) {
    var card = document.getElementById("card");
    card.setAttribute("data-theme", name);
    document.body.setAttribute("data-page-theme", name);
    var btns = document.querySelectorAll(".tbtn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-set") === name);
    }
    try { localStorage.setItem("aw-theme", name); } catch (e) {}
  }

  function shareX() {
    var s = current.stats, a = s.archetype || {};
    var t = "My Agent Wrapped (" + s.period.label + "): " + fmtInt(s.linesWritten) +
      " lines of code my AI agent wrote, " + (a.emoji || "") + " " + (a.name || "") +
      ". Get yours: " + RUN + "  " + current.handle;
    window.open("https://x.com/intent/tweet?text=" + encodeURIComponent(t), "_blank");
  }

  function downloadPNG() {
    var card = document.getElementById("card");
    var w = card.offsetWidth, h = card.offsetHeight; // 1600x900, ignores transform
    var css = "";
    var styleEl = document.getElementById("aw-style");
    if (styleEl) css = styleEl.textContent;
    var clone = card.cloneNode(true);
    clone.style.transform = "none";
    var xml = new XMLSerializer().serializeToString(clone);
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + w + "' height='" + h + "'>" +
      "<foreignObject width='100%' height='100%'>" +
      "<div xmlns='http://www.w3.org/1999/xhtml'><style>" + css + "</style>" + xml + "</div>" +
      "</foreignObject></svg>";
    var img = new Image();
    img.onload = function () {
      var sc = 2, c = document.createElement("canvas");
      c.width = w * sc; c.height = h * sc;
      var ctx = c.getContext("2d"); ctx.scale(sc, sc); ctx.drawImage(img, 0, 0);
      c.toBlob(function (b) {
        var url = URL.createObjectURL(b), el = document.createElement("a");
        var label = (current.stats.period.label || "wrapped").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        el.href = url; el.download = "agent-wrapped-" + label + ".png";
        el.click(); URL.revokeObjectURL(url);
      }, "image/png");
    };
    img.onerror = function () { alert("PNG export needs a Chromium-based browser (Chrome/Edge). Otherwise just screenshot the card."); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function render(stats, handle) {
    current.stats = stats;
    current.handle = handle || "@geartbuilds";
    document.getElementById("card").innerHTML = buildCard(stats, current.handle);
    var saved = null;
    try { saved = localStorage.getItem("aw-theme"); } catch (e) {}
    applyTheme(saved || "dark");
    fit();
    window.addEventListener("resize", fit);

    var btns = document.querySelectorAll(".tbtn");
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () { applyTheme(btn.getAttribute("data-set")); });
      })(btns[i]);
    }
    var dl = document.getElementById("dl"); if (dl) dl.addEventListener("click", downloadPNG);
    var sx = document.getElementById("sx"); if (sx) sx.addEventListener("click", shareX);
  }

  window.AgentWrapped = { render: render };
})();
