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
    let mediaReady = false;
    let decoderPrimed = false;
    let raf = 0;

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
    video.addEventListener("loadeddata", onMediaReady);
    video.addEventListener("canplay", onMediaReady);
    video.addEventListener("seeked", onSeeked);

    window.addEventListener("resize", applyTrackHeight, { passive: true });
    window.addEventListener("pointerdown", primeDecoder, { passive: true });
    window.addEventListener("touchstart", primeDecoder, { passive: true });
    // iOS Safari sospende il RAF durante lo scroll touch: pilotiamo anche da scroll.
    window.addEventListener("scroll", render, { passive: true });
    window.addEventListener("touchmove", render, { passive: true });

    load();
    raf = requestAnimationFrame(loop);
  }

  /* ===================================================================
     Istanza 1 — Hero
     =================================================================== */
  const loader = document.getElementById("loader");
  createScrollVideo({
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
  createScrollVideo({
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
