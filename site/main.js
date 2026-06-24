/* ===================================================================
   Bootei — video controllati dallo scroll
   Implementazione vanilla dei principi del CINEMATIC-SCROLL-PLAYBOOK.
   Motore riutilizzabile: stessa logica per la hero e per il 3D scarpa.
   Una sola fonte di verità per il tempo: il progresso dello scroll.
   =================================================================== */

(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Safari/WebKit: URL diretto (un blob: rompe lo scrubbing su WebKit).
  // Chromium/Firefox: blob in memoria, così il seek non dipende dalle
  // richieste HTTP Range (che il server di sviluppo non gestisce).
  const ua = navigator.userAgent;
  const isAppleWebKit =
    /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua);
  const useCanvas = !/(Firefox|FxiOS)/i.test(ua);

  function fade(p, c) {
    if (p <= c.in || p >= c.out) return 0;
    if (p < c.hold0) return (p - c.in) / (c.hold0 - c.in);
    if (p > c.hold1) return 1 - (p - c.hold1) / (c.out - c.hold1);
    return 1;
  }

  /* ===================================================================
     Factory: un'esperienza video-scroll su un .track/.stage
     =================================================================== */
  function createScrollVideo(opts) {
    const {
      src, track, video, canvas, chapterEls = [], chapters = [],
      progressEl = null, scrollHintEl = null, pxPerSecond = 640, onReady = null,
    } = opts;

    if (!track || !video) return;

    const ctx = canvas ? canvas.getContext("2d", { alpha: true }) : null;
    if (canvas) canvas.hidden = !useCanvas;

    let duration = 0;
    let desiredTime = 0;
    let seeking = false;
    let seekWatchdog = 0;
    let lastSeekAt = 0;
    let mediaReady = false;
    let decoderPrimed = false;
    let loadFallbackDone = false;
    let raf = 0;

    // contatori per debug
    const dbg = { loadeddata: 0, canplay: 0, seeked: 0, seekIssued: 0, scroll: 0, touchmove: 0, raf: 0, watchdog: 0 };

    function applyTrackHeight() {
      if (!duration) return;
      track.style.height =
        `${Math.round(duration * pxPerSecond + window.innerHeight)}px`;
    }

    function getProgress() {
      const max = track.offsetHeight - window.innerHeight;
      const scrolled = -track.getBoundingClientRect().top;
      if (max <= 0) return 0;
      return Math.min(1, Math.max(0, scrolled / max));
    }

    function seekTo(time) {
      if (seeking) return;
      if (Math.abs(time - video.currentTime) < 0.01) return;
      seeking = true;
      dbg.seekIssued++;
      // Watchdog: Firefox (specie mobile/APZ) può accorpare o scartare un seek
      // senza emettere "seeked", lasciando il flag bloccato per sempre. Lo
      // sblocchiamo dopo un attimo così il loop può riprovare verso desiredTime.
      clearTimeout(seekWatchdog);
      lastSeekAt = performance.now();
      seekWatchdog = setTimeout(() => { seeking = false; dbg.watchdog++; }, 220);
      try {
        video.currentTime = time;
      } catch {
        seeking = false;
        clearTimeout(seekWatchdog);
      }
    }

    function onSeeked() {
      clearTimeout(seekWatchdog);
      seeking = false;
      dbg.seeked++;
      paintFrame();
      if (Math.abs(desiredTime - video.currentTime) > 0.01) {
        seekTo(desiredTime);
      }
    }

    function sizeCanvas() {
      if (!canvas || !video.videoWidth || !video.videoHeight) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    function paintFrame() {
      if (!useCanvas || !ctx) return;
      if (!canvas.width || video.readyState < 2) return;
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch {
        /* frame non ancora decodificato */
      }
    }

    function onMediaReady() {
      if (mediaReady) return;
      mediaReady = true;
      sizeCanvas();
      if (onReady) onReady();
      primeDecoder();
      seekTo(0.04);
      paintFrame();
    }

    function primeDecoder() {
      if (decoderPrimed || video.readyState < 2) return;
      decoderPrimed = true;
      const result = video.play();
      if (!result) {
        requestAnimationFrame(() => {
          video.pause();
          seekTo(desiredTime || 0.04);
        });
        return;
      }
      result
        .then(() => {
          requestAnimationFrame(() => {
            video.pause();
            seekTo(desiredTime || 0.04);
          });
        })
        .catch(() => { decoderPrimed = false; });
    }

    function readDuration() {
      if (video.duration && isFinite(video.duration)) {
        duration = video.duration;
        applyTrackHeight();
      }
    }

    function updateChapters(p) {
      for (let i = 0; i < chapterEls.length; i++) {
        const el = chapterEls[i];
        const c = chapters[i];
        if (!el || !c) continue;
        const o = fade(p, c);
        el.style.opacity = o;
        el.style.transform = reduceMotion
          ? "translateY(0)"
          : `translateY(${(1 - o) * 26}px)`;
        el.style.pointerEvents = o > 0.6 ? "auto" : "none";
      }
    }

    function render() {
      // Recupero: se il nostro flag è ancora "seeking" ma il browser non sta
      // più cercando (evento "seeked" perso, tipico di Firefox/APZ), sblocca.
      if (seeking && !video.seeking && performance.now() - lastSeekAt > 120) {
        seeking = false;
        clearTimeout(seekWatchdog);
      }

      const p = getProgress();
      if (duration && video.readyState >= 1) {
        desiredTime = p * Math.max(0, duration - 0.04);
        seekTo(desiredTime);
      }
      paintFrame();
      updateChapters(p);
      if (progressEl) progressEl.style.width = `${(p * 100).toFixed(2)}%`;
      if (scrollHintEl) scrollHintEl.classList.toggle("is-hidden", p > 0.04);
    }

    function loop() {
      dbg.raf++;
      render();
      raf = requestAnimationFrame(loop);
    }

    function load() {
      if (isAppleWebKit) {
        video.src = src;
        video.load();
        return;
      }
      fetch(src)
        .then((res) => {
          if (!res.ok) throw new Error(`Video request failed: ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          video.src = URL.createObjectURL(blob);
          video.load();
        })
        .catch((err) => {
          console.warn("Blob load fallito, uso URL diretto:", err);
          video.src = src;
          video.load();
        });
    }

    // Listeners
    video.addEventListener("loadedmetadata", readDuration);
    video.addEventListener("durationchange", readDuration);
    video.addEventListener("loadeddata", () => { dbg.loadeddata++; onMediaReady(); });
    video.addEventListener("canplay", () => { dbg.canplay++; onMediaReady(); });
    video.addEventListener("seeked", onSeeked);

    window.addEventListener("resize", applyTrackHeight, { passive: true });
    window.addEventListener("pointerdown", primeDecoder, { passive: true });
    window.addEventListener("touchstart", primeDecoder, { passive: true });
    // iOS Safari sospende il RAF durante lo scroll touch: pilotiamo anche da scroll.
    window.addEventListener("scroll", () => { dbg.scroll++; render(); }, { passive: true });
    window.addEventListener("touchmove", () => { dbg.touchmove++; render(); }, { passive: true });

    // Backstop: se RAF, scroll e touchmove vengono tutti rallentati (mobile),
    // questo tick a bassa frequenza fa comunque convergere il video allo scroll.
    setInterval(render, 250);

    // Ritorno da bfcache (back/forward su mobile): ri-priming e re-render.
    window.addEventListener("pageshow", () => {
      decoderPrimed = false;
      primeDecoder();
      render();
    });

    // Se il video non è pronto dopo qualche secondo (blob lento o bloccato),
    // riprova una volta dall'URL diretto.
    setTimeout(() => {
      if (!mediaReady && !loadFallbackDone) {
        loadFallbackDone = true;
        video.src = src;
        video.load();
      }
    }, 4500);

    load();
    raf = requestAnimationFrame(loop);

    // API di stato per il pannello di debug
    return {
      snapshot() {
        return {
          dur: duration ? +duration.toFixed(2) : null,
          rs: video.readyState,
          vw: video.videoWidth,
          err: video.error ? video.error.code : null,
          trackH: track.offsetHeight,
          winH: window.innerHeight,
          prog: +getProgress().toFixed(3),
          want: +desiredTime.toFixed(2),
          ct: +video.currentTime.toFixed(2),
          flagSeek: seeking,
          natSeek: video.seeking,
          ...dbg,
        };
      },
    };
  }

  /* ===================================================================
     Istanza 1 — Hero
     =================================================================== */
  const loader = document.getElementById("loader");
  const heroApi = createScrollVideo({
    src: "public/hero-motion.mp4",
    track: document.getElementById("track"),
    video: document.getElementById("video"),
    canvas: document.getElementById("canvas"),
    chapterEls: Array.from(document.querySelectorAll("#track [data-chapter]")),
    progressEl: document.getElementById("progress"),
    scrollHintEl: document.getElementById("scrollHint"),
    pxPerSecond: 640,
    onReady: () => loader && loader.classList.add("is-done"),
    chapters: [
      { in: -0.05, hold0: 0.00, hold1: 0.14, out: 0.20 },
      { in:  0.20, hold0: 0.27, hold1: 0.37, out: 0.43 },
      { in:  0.43, hold0: 0.50, hold1: 0.60, out: 0.66 },
      { in:  0.66, hold0: 0.72, hold1: 0.82, out: 0.88 },
      { in:  0.88, hold0: 0.95, hold1: 1.00, out: 1.01 },
    ],
  });

  // Safety: se gli eventi tardano, non lasciare il loader bloccato
  setTimeout(() => { if (loader) loader.classList.add("is-done"); }, 6000);

  /* ===================================================================
     Istanza 2 — 3D scarpa (cinematic)
     =================================================================== */
  const shoeApi = createScrollVideo({
    src: "public/shoe-3d.mp4",
    track: document.getElementById("track3d"),
    video: document.getElementById("video3d"),
    canvas: document.getElementById("canvas3d"),
    chapterEls: Array.from(document.querySelectorAll("#track3d [data-chapter]")),
    progressEl: document.getElementById("progress3d"),
    pxPerSecond: 620,
    chapters: [
      { in: -0.05, hold0: 0.00, hold1: 0.16, out: 0.24 },
      { in:  0.24, hold0: 0.32, hold1: 0.46, out: 0.54 },
      { in:  0.54, hold0: 0.62, hold1: 0.76, out: 0.84 },
      { in:  0.84, hold0: 0.92, hold1: 1.00, out: 1.01 },
    ],
  });

  /* ===================================================================
     Pannello di debug — attivo solo con ?debug nell'URL
     =================================================================== */
  if (/(\?|&|#)debug/.test(location.href)) {
    const panel = document.createElement("pre");
    panel.id = "dbgPanel";
    panel.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:9999;margin:0;" +
      "max-height:46vh;overflow:auto;background:rgba(0,0,0,.86);color:#0f0;" +
      "font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;" +
      "white-space:pre-wrap;border-top:2px solid #0f0;-webkit-user-select:text;user-select:text;";
    document.body.appendChild(panel);

    const fmt = (label, s) =>
      `■ ${label}\n` +
      `  load: dur=${s.dur} rs=${s.rs} vw=${s.vw} err=${s.err}\n` +
      `  track=${s.trackH} win=${s.winH} scrollRoom=${s.trackH - s.winH}\n` +
      `  prog=${s.prog} want=${s.want}s ct=${s.ct}s\n` +
      `  seekFlag=${s.flagSeek} nativeSeeking=${s.natSeek}\n` +
      `  ev: loadeddata=${s.loadeddata} canplay=${s.canplay} seeked=${s.seeked} seekIssued=${s.seekIssued} watchdog=${s.watchdog}\n` +
      `  drive: raf=${s.raf} scroll=${s.scroll} touchmove=${s.touchmove}`;

    function tick() {
      const ua = navigator.userAgent;
      let txt = "BOOTEI debug — " + ua + "\n";
      txt += "scrollY=" + Math.round(window.scrollY) + " innerH=" + window.innerHeight +
             " docH=" + document.documentElement.scrollHeight + "\n\n";
      if (heroApi) txt += fmt("HERO", heroApi.snapshot()) + "\n\n";
      if (shoeApi) txt += fmt("3D SCARPA", shoeApi.snapshot());
      panel.textContent = txt;
      setTimeout(tick, 250);
    }
    tick();
  }

  /* ===================================================================
     Resto del sito "in movimento": reveal sezioni + colorway grid
     =================================================================== */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        const delay = e.target.dataset.revealDelay || 0;
        e.target.style.transitionDelay = `${delay}ms`;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });

  document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));

  // Catalogo reale Bootei (nomi, prezzi e foto da bootei.it)
  const PRODUCTS = [
    { name: "Sabot Deserto",   img: "deserto.jpg",   price: 389 },
    { name: "Sabot Asfalto",   img: "asfalto.jpg",   price: 389 },
    { name: "Sabot Bianco",    img: "bianco.jpg",    price: 329 },
    { name: "Sabot Arancione", img: "arancione.jpg", price: 389 },
    { name: "Sabot Marrone",   img: "marrone.jpg",   price: 389 },
    { name: "Sabot Nero",      img: "nero.jpg",      price: 329 },
    { name: "Sabot Silice",    img: "silice.jpg",    price: 329 },
    { name: "Sabot Zinco",     img: "zinco.jpg",     price: 389 },
    { name: "Sabot Desert",    img: "desert.jpg",    price: 329 },
  ];

  const grid = document.getElementById("grid");
  if (grid) {
    PRODUCTS.forEach((c, i) => {
      const card = document.createElement("article");
      card.className = "card reveal";
      card.setAttribute("data-reveal", "");
      card.dataset.revealDelay = (i % 4) * 80;
      card.innerHTML = `
        <div class="card__swatch">
          <img class="card__img" src="public/products/${c.img}" alt="${c.name}" loading="lazy" />
        </div>
        <div class="card__meta">
          <span class="card__name">${c.name}</span>
          <span class="card__price">€${c.price}</span>
        </div>`;
      grid.appendChild(card);
      io.observe(card);
    });
  }
})();
