/* ===================================================================
   Bootei — hero video controllato dallo scroll
   Implementazione vanilla dei principi del CINEMATIC-SCROLL-PLAYBOOK.
   Una sola fonte di verità per il tempo: il progresso dello scroll.
   =================================================================== */

(() => {
  "use strict";

  const VIDEO_SRC = "public/hero-motion.mp4";
  const PX_PER_SECOND = 640;

  const video   = document.getElementById("video");
  const canvas  = document.getElementById("canvas");
  const track   = document.getElementById("track");
  const loader  = document.getElementById("loader");
  const progress = document.getElementById("progress");
  const scrollHint = document.getElementById("scrollHint");
  const chapterEls = Array.from(document.querySelectorAll("[data-chapter]"));

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Firefox usa il video nativo; gli altri possono usare il canvas.
  const useCanvas = !/(Firefox|FxiOS)/i.test(navigator.userAgent);
  canvas.hidden = !useCanvas;
  const ctx = canvas.getContext("2d", { alpha: true });

  // ---- stato (no React/DOM state nel loop) ----
  let duration = 0;
  let desiredTime = 0;
  let seeking = false;
  let mediaReady = false;
  let decoderPrimed = false;
  let raf = 0;

  /* ---------------- Capitoli ---------------- */
  const CHAPTERS = [
    { in: -0.05, hold0: 0.00, hold1: 0.14, out: 0.20 },
    { in:  0.20, hold0: 0.27, hold1: 0.37, out: 0.43 },
    { in:  0.43, hold0: 0.50, hold1: 0.60, out: 0.66 },
    { in:  0.66, hold0: 0.72, hold1: 0.82, out: 0.88 },
    { in:  0.88, hold0: 0.95, hold1: 1.00, out: 1.01 },
  ];

  function fade(p, c) {
    if (p <= c.in || p >= c.out) return 0;
    if (p < c.hold0) return (p - c.in) / (c.hold0 - c.in);
    if (p > c.hold1) return 1 - (p - c.hold1) / (c.out - c.hold1);
    return 1;
  }

  function updateChapters(p) {
    for (let i = 0; i < chapterEls.length; i++) {
      const el = chapterEls[i];
      const o = fade(p, CHAPTERS[i]);
      el.style.opacity = o;
      el.style.transform = reduceMotion
        ? "translateY(0)"
        : `translateY(${(1 - o) * 26}px)`;
      el.style.pointerEvents = o > 0.6 ? "auto" : "none";
    }
  }

  /* ---------------- Scroll / progresso ---------------- */
  function applyTrackHeight() {
    if (!duration) return;
    track.style.height =
      `${Math.round(duration * PX_PER_SECOND + window.innerHeight)}px`;
  }

  function getProgress() {
    const max = track.offsetHeight - window.innerHeight;
    const scrolled = -track.getBoundingClientRect().top;
    if (max <= 0) return 0;
    return Math.min(1, Math.max(0, scrolled / max));
  }

  /* ---------------- Seek serializzato ---------------- */
  function seekTo(time) {
    if (seeking) return;
    if (Math.abs(time - video.currentTime) < 0.01) return;
    seeking = true;
    try {
      video.currentTime = time;
    } catch {
      seeking = false;
    }
  }

  function onSeeked() {
    seeking = false;
    paintFrame();
    if (Math.abs(desiredTime - video.currentTime) > 0.01) {
      seekTo(desiredTime);
    }
  }

  /* ---------------- Canvas ---------------- */
  function sizeCanvas() {
    if (!video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  function paintFrame() {
    if (!useCanvas) return;
    if (!canvas.width || video.readyState < 2) return;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } catch {
      /* frame non ancora decodificato */
    }
  }

  /* ---------------- Inizializzazione media: una volta ---------------- */
  function onMediaReady() {
    if (mediaReady) return;
    mediaReady = true;

    sizeCanvas();
    loader.classList.add("is-done");
    primeDecoder();
    seekTo(0.04);
    paintFrame();
  }

  /* ---------------- Priming mobile ---------------- */
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

  /* ---------------- Metadata / durata ---------------- */
  function readDuration() {
    if (video.duration && isFinite(video.duration)) {
      duration = video.duration;
      applyTrackHeight();
    }
  }

  /* ---------------- Loop principale ---------------- */
  function loop() {
    const p = getProgress();

    if (duration && video.readyState >= 1) {
      desiredTime = p * Math.max(0, duration - 0.04);
      seekTo(desiredTime);
    }

    paintFrame();
    updateChapters(p);
    progress.style.width = `${(p * 100).toFixed(2)}%`;

    if (scrollHint) {
      scrollHint.classList.toggle("is-hidden", p > 0.04);
    }

    raf = requestAnimationFrame(loop);
  }

  /* ---------------- Caricamento via Blob ---------------- */
  async function loadVideoAsBlob() {
    try {
      const res = await fetch(VIDEO_SRC);
      if (!res.ok) throw new Error(`Video request failed: ${res.status}`);
      const blob = await res.blob();
      video.src = URL.createObjectURL(blob);
      video.load();
    } catch (err) {
      // Fallback: URL diretto
      console.warn("Blob load fallito, uso URL diretto:", err);
      video.src = VIDEO_SRC;
      video.load();
    }
  }

  /* ---------------- Listeners ---------------- */
  video.addEventListener("loadedmetadata", readDuration);
  video.addEventListener("durationchange", readDuration);
  video.addEventListener("loadeddata", onMediaReady);
  video.addEventListener("canplay", onMediaReady);
  video.addEventListener("seeked", onSeeked);

  window.addEventListener("resize", applyTrackHeight, { passive: true });
  window.addEventListener("pointerdown", primeDecoder, { passive: true });
  window.addEventListener("touchstart", primeDecoder, { passive: true });

  // Safety: se gli eventi tardano, non lasciare il loader bloccato
  setTimeout(() => { if (!mediaReady) loader.classList.add("is-done"); }, 6000);

  loadVideoAsBlob();
  raf = requestAnimationFrame(loop);

  /* ===================================================================
     Resto del sito "in movimento": reveal sezioni + colorway grid
     =================================================================== */

  // Header: cambia mix-blend quando si lascia la hero
  const nav = document.getElementById("nav");
  window.addEventListener("scroll", () => {
    const overHero = track.getBoundingClientRect().bottom > window.innerHeight * 0.4;
    nav.style.mixBlendMode = overHero ? "difference" : "normal";
    nav.style.color = overHero ? "#fff" : "var(--ink)";
  }, { passive: true });

  // Reveal on scroll
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

  // Colorway grid
  const COLORWAYS = [
    { name: "Deserto",   bg: "#c9b79c", shoe: "rgba(80,60,40,.35)",  price: 329 },
    { name: "Asfalto",   bg: "#4a4a4d", shoe: "rgba(0,0,0,.4)",      price: 349 },
    { name: "Bianco",    bg: "#eceae4", shoe: "rgba(0,0,0,.14)",     price: 329 },
    { name: "Arancione", bg: "#d9531e", shoe: "rgba(90,30,10,.35)",  price: 369 },
    { name: "Marrone",   bg: "#6b4a33", shoe: "rgba(0,0,0,.35)",     price: 349 },
    { name: "Nero",      bg: "#1b1a16", shoe: "rgba(0,0,0,.5)",      price: 389 },
    { name: "Silice",    bg: "#d8d5cc", shoe: "rgba(0,0,0,.16)",     price: 329 },
  ];

  const grid = document.getElementById("grid");
  if (grid) {
    COLORWAYS.forEach((c, i) => {
      const card = document.createElement("article");
      card.className = "card reveal";
      card.setAttribute("data-reveal", "");
      card.dataset.revealDelay = (i % 4) * 80;
      card.innerHTML = `
        <div class="card__swatch" style="background:${c.bg}">
          <span class="card__shoe" style="background:${c.shoe}"></span>
        </div>
        <div class="card__meta">
          <span class="card__name">Sabot ${c.name}</span>
          <span class="card__price">€${c.price}</span>
        </div>`;
      grid.appendChild(card);
      io.observe(card);
    });
  }
})();
