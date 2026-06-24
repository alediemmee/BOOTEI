# Video controllato dallo scroll

Guida pratica per realizzare una hero full-screen in cui lo scroll controlla il tempo di un video.

Obiettivi:

- comportamento stabile su desktop e mobile;
- compatibilità con Chromium, Safari e Firefox;
- deploy affidabile su Cloudflare Pages;
- codice lineare, senza librerie di animazione o aggiornamenti React per frame.

---

## 1. Architettura raccomandata

Usare quattro elementi:

```text
.track                 area scrollabile, alta in base alla durata del video
└── .stage             viewport sticky
    ├── video          sorgente e fallback visivo
    ├── canvas         livello visivo opzionale per Chromium/Safari
    └── chapters       testi sovrapposti
```

Responsabilità:

1. `.track` determina quanto scroll serve.
2. `.stage` resta fermo con `position: sticky`.
3. Lo scroll produce un progresso normalizzato da `0` a `1`.
4. Il progresso determina `video.currentTime`.
5. I capitoli usano lo stesso progresso per opacity e transform.

Non collegare la durata dell'esperienza all'altezza dei testi.

---

## 2. Preparazione del video

Lo scrubbing richiede seek rapidi e precisi. Preparare un MP4 H.264 senza audio, con pixel format `yuv420p`, fast start e keyframe frequenti.

Per clip brevi, fino a circa 10–15 secondi, usare un keyframe per frame:

```bash
ffmpeg -y -i "source.mp4" \
  -an \
  -vf "scale=1600:-2" \
  -c:v libx264 \
  -profile:v high \
  -pix_fmt yuv420p \
  -preset slow \
  -crf 21 \
  -x264-params "keyint=1:min-keyint=1:scenecut=0" \
  -movflags +faststart \
  "public/hero-motion.mp4"
```

Controllare il risultato:

```bash
ffprobe -v error \
  -show_entries format=duration,size \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate \
  -of json \
  "public/hero-motion.mp4"
```

Gold standard:

- H.264;
- `yuv420p`;
- nessuna traccia audio;
- risoluzione tra 1280 e 1920 px di larghezza;
- file idealmente sotto 15–25 MB;
- nome semplice, senza spazi;
- poster JPG coerente con il primo frame.

Per video più lunghi ridurre la risoluzione o usare un GOP piccolo, per esempio `keyint=5`, evitando file eccessivi.

---

## 3. Markup

Il video deve essere un elemento reale, full-size e dentro la viewport sticky. Non ridurlo a pochi pixel, non usare `display: none` e non posizionarlo con `z-index` negativo: Safari mobile può sospenderne la decodifica.

```jsx
<section className="track" ref={trackRef}>
  <div className="stage">
    <video
      ref={videoRef}
      className="video-source"
      muted
      playsInline
      preload="auto"
      poster="/hero-poster.jpg"
    />

    <canvas ref={canvasRef} className="video-canvas" />

    <div className="chapter">...</div>
    <div className="chapter">...</div>
  </div>
</section>
```

Attributi obbligatori:

- `muted`;
- `playsInline`;
- `preload="auto"`;
- `poster`.

Non usare `autoplay` o `loop`: lo scroll è l'unico controllore del tempo.

---

## 4. CSS essenziale

```css
.page {
  position: relative;
  width: 100%;
  overflow-x: clip;
}

.track {
  position: relative;
  width: 100%;
}

.stage {
  position: sticky;
  top: 0;
  width: 100%;
  height: 100vh;
  height: 100svh;
  overflow: hidden;
}

.video-source,
.video-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.video-source {
  pointer-events: none;
}

.video-canvas {
  display: block;
}

.video-canvas[hidden] {
  display: none;
}

.chapter {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  opacity: 0;
  will-change: opacity, transform;
}
```

Usare `overflow-x: clip`, non `hidden`, sugli antenati dello sticky.

Per migliorare la leggibilità preferire ombre sul testo. Non aggiungere automaticamente gradienti, vignette o scrim scuri sopra tutto il video.

---

## 5. Caricamento affidabile

Su alcuni CDN il supporto alle richieste HTTP Range può non essere uniforme. Per clip brevi, scaricare il file una volta e usare un Blob URL locale:

```js
async function loadVideoAsBlob(video) {
  const response = await fetch("/hero-motion.mp4");
  if (!response.ok) {
    throw new Error(`Video request failed: ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  video.src = objectUrl;
  video.load();

  return objectUrl;
}
```

Regole:

- controllare sempre `response.ok`;
- fare una sola richiesta;
- non impostare contemporaneamente `src` nel JSX e via JavaScript;
- mantenere il Blob URL per tutta la vita della pagina;
- usare l'URL diretto solo come fallback.

Per asset grandi usare storage/CDN configurato correttamente per Range requests, invece di caricare tutto in memoria.

---

## 6. Calcolo dello scroll

La lunghezza della track deriva dalla durata:

```js
const PX_PER_SECOND = 560;

function applyTrackHeight(track, duration) {
  track.style.height =
    `${Math.round(duration * PX_PER_SECOND + window.innerHeight)}px`;
}
```

Il progresso:

```js
function getProgress(track) {
  const max = track.offsetHeight - window.innerHeight;
  const scrolled = -track.getBoundingClientRect().top;

  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, scrolled / max));
}
```

Il tempo desiderato:

```js
const targetTime = progress * Math.max(0, duration - 0.04);
```

Non applicare easing numerico a `currentTime`. Durante lo scroll rapido crea ritardo, accumulo e oscillazioni. Il video deve inseguire direttamente la posizione richiesta.

---

## 7. Seek serializzato

Non assegnare `currentTime` indiscriminatamente a ogni frame. Chromium può accorpare o scartare seek concorrenti.

Usare un seek alla volta:

```js
let desiredTime = 0;
let seeking = false;

function seekTo(video, time) {
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
    seekTo(video, desiredTime);
  }
}

video.addEventListener("seeked", onSeeked);
```

Nel loop:

```js
desiredTime = progress * Math.max(0, duration - 0.04);
seekTo(video, desiredTime);
```

Questo è il punto centrale dell'implementazione.

---

## 8. Rendering cross-browser

### Strategia

- Firefox: mostrare direttamente il `<video>`.
- Chromium e Safari: è possibile mostrare un canvas aggiornato dal video se il browser non ridisegna bene i frame di un video in pausa.
- Il video deve comunque restare visibile sotto il canvas come fallback.
- Il canvas deve avere alpha trasparente; un canvas opaco nasce nero.

```js
const useCanvas = !/(Firefox|FxiOS)/i.test(navigator.userAgent);
canvas.hidden = !useCanvas;

const context = canvas.getContext("2d", { alpha: true });

function paintFrame() {
  if (!useCanvas) return;
  if (!canvas.width || video.readyState < 2) return;

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch {
    // Il frame non è ancora decodificato.
  }
}
```

Dimensionare il bitmap del canvas dai dati reali del video:

```js
function sizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}
```

Chiamare `paintFrame()`:

- dopo `seeked`;
- dopo il primo frame disponibile;
- nel RAF, solo se si usa il canvas.

Il callback `seeked` è importante su mobile perché il browser può rallentare `requestAnimationFrame` durante lo scroll touch.

---

## 9. Inizializzazione media: una sola volta

Firefox può emettere `canplay` più volte, anche dopo ogni seek. Se il callback riporta ogni volta il video al primo frame, si crea un loop avanti/indietro.

Usare una guardia:

```js
let mediaReady = false;

function onMediaReady() {
  if (mediaReady) return;
  mediaReady = true;

  setReady(true);
  primeDecoder();
  seekTo(video, 0.04);
  paintFrame();
}

video.addEventListener("loadeddata", onMediaReady);
video.addEventListener("canplay", onMediaReady);
```

Principio generale: tutto ciò che inizializza il video deve essere idempotente.

Non usare callback anonimi per eventi che devono essere rimossi nel cleanup.

---

## 10. Priming su mobile

iOS può richiedere che il decoder venga avviato almeno una volta. Tentare playback muted e inline, poi mettere subito in pausa:

```js
let decoderPrimed = false;

function primeDecoder() {
  if (decoderPrimed || video.readyState < 2) return;
  decoderPrimed = true;

  const result = video.play();

  if (!result) {
    requestAnimationFrame(() => {
      video.pause();
      seekTo(video, desiredTime || 0.04);
    });
    return;
  }

  result
    .then(() => {
      requestAnimationFrame(() => {
        video.pause();
        seekTo(video, desiredTime || 0.04);
      });
    })
    .catch(() => {
      decoderPrimed = false;
    });
}
```

Invocarlo:

- al primo `loadeddata`/`canplay`;
- al primo `pointerdown`;
- al primo `touchstart`.

Il listener può restare semplice: la guardia `decoderPrimed` impedisce esecuzioni ripetute.

---

## 11. Loop principale

Il loop deve avere poche responsabilità:

```js
function loop() {
  const progress = getProgress(track);

  if (duration && video.readyState >= 1) {
    desiredTime =
      progress * Math.max(0, duration - 0.04);
    seekTo(video, desiredTime);
  }

  paintFrame();
  updateChapters(progress);
  updateProgressBar(progress);

  raf = requestAnimationFrame(loop);
}
```

Non usare React state per:

- tempo del video;
- progresso;
- opacity dei capitoli;
- transform dei capitoli;
- barra di avanzamento.

Usare ref e scritture DOM dirette. React state serve solo per eventi a bassa frequenza, per esempio nascondere il loader.

---

## 12. Capitoli

Definire ogni capitolo come finestra sul progresso:

```js
const CHAPTERS = [
  { in: -0.05, hold0: 0.00, hold1: 0.15, out: 0.21 },
  { in: 0.24, hold0: 0.30, hold1: 0.40, out: 0.46 },
  { in: 0.49, hold0: 0.55, hold1: 0.66, out: 0.72 },
  { in: 0.74, hold0: 0.80, hold1: 0.90, out: 0.95 },
  { in: 0.95, hold0: 0.985, hold1: 1.00, out: 1.01 },
];

function fade(progress, chapter) {
  if (progress <= chapter.in || progress >= chapter.out) return 0;

  if (progress < chapter.hold0) {
    return (progress - chapter.in) /
      (chapter.hold0 - chapter.in);
  }

  if (progress > chapter.hold1) {
    return 1 -
      (progress - chapter.hold1) /
      (chapter.out - chapter.hold1);
  }

  return 1;
}
```

Aggiornamento:

```js
function updateChapters(progress) {
  chapterRefs.current.forEach((element, index) => {
    if (!element) return;

    const opacity = fade(progress, CHAPTERS[index]);
    element.style.opacity = opacity;
    element.style.transform =
      `translateY(${(1 - opacity) * 28}px)`;
    element.style.pointerEvents =
      opacity > 0.6 ? "auto" : "none";
  });
}
```

---

## 13. Reduced motion

`prefers-reduced-motion` non deve bloccare il video sul primo frame se lo scrub è la funzione principale della pagina.

Ridurre solo le animazioni decorative:

```js
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

element.style.transform = reduceMotion
  ? "translateY(0)"
  : `translateY(${(1 - opacity) * 28}px)`;
```

Disattivare inoltre pulse, parallax e transizioni automatiche non essenziali.

---

## 14. Cleanup

Rimuovere ogni listener con lo stesso riferimento usato in registrazione:

```js
return () => {
  cancelled = true;
  cancelAnimationFrame(raf);

  window.removeEventListener("resize", applyTrackHeight);
  window.removeEventListener("pointerdown", primeDecoder);
  window.removeEventListener("touchstart", primeDecoder);

  video.removeEventListener("loadedmetadata", onMetadata);
  video.removeEventListener("durationchange", readDuration);
  video.removeEventListener("loadeddata", onMediaReady);
  video.removeEventListener("canplay", onMediaReady);
  video.removeEventListener("seeked", onSeeked);
};
```

Questo è particolarmente importante in React Strict Mode, che in sviluppo monta, smonta e rimonta gli effect per rilevare side effect non sicuri.

---

## 15. Cloudflare Pages

Configurazione Vite:

```text
Framework preset: React (Vite)
Build command: npm run build
Build output directory: dist
Root directory: vuota, se package.json è nella root del repository
Production branch: main
```

Prima di analizzare problemi JavaScript, verificare che online sia pubblicato il progetto corretto.

Controlli:

```bash
curl -I https://example.pages.dev/
curl -I https://example.pages.dev/hero-motion.mp4
```

Verificare:

- homepage corrispondente alla build corrente;
- asset video con status `200`;
- `Content-Type: video/mp4`;
- commit del deployment uguale all'ultimo commit GitHub;
- nessuna vecchia app o vecchio progetto Pages associato allo stesso dominio.

Se locale funziona e online mostra un'app diversa, il problema è il deployment, non lo scrub.

---

## 16. Procedura di implementazione

Seguire questo ordine:

1. Preparare e verificare il video con ffmpeg/ffprobe.
2. Creare `.track` e `.stage`.
3. Inserire il video full-size con poster.
4. Caricare il video e leggere `duration`.
5. Calcolare l'altezza della track.
6. Implementare il progresso `0..1`.
7. Implementare il seek serializzato.
8. Testare il solo video, senza testi né overlay.
9. Aggiungere il canvas solo dove necessario.
10. Applicare il fallback video nativo per Firefox.
11. Aggiungere il priming mobile.
12. Aggiungere i capitoli.
13. Gestire reduced motion.
14. Eseguire build di produzione.
15. Testare il deploy reale.

Non aggiungere loader, canvas, blob e fallback tutti insieme prima di aver verificato il livello precedente.

---

## 17. Matrice minima di test

Testare almeno:

| Ambiente | Cosa verificare |
|---|---|
| Chrome desktop | seek fluido avanti e indietro |
| Firefox desktop | nessun frame nero o oscillazione |
| Safari desktop | decodifica e sticky |
| Chrome Android | scroll touch e frame aggiornati |
| Firefox Android | video nativo stabile a scroll fermo |
| Safari iOS | playsInline, priming e scroll touch |
| Navigazione privata | nessuna dipendenza da cache |
| Reduced motion attivo | scrub funzionante, decorazioni ridotte |
| Cloudflare Pages | build corretta e asset disponibile |

Per ogni browser:

1. aprire la pagina da zero;
2. attendere il primo frame;
3. scorrere lentamente;
4. scorrere rapidamente;
5. fermarsi a metà per almeno cinque secondi;
6. tornare indietro;
7. ruotare o ridimensionare la viewport;
8. ricaricare senza cache.

Un video che cambia frame mentre lo scroll è fermo è sempre un bug.

---

## 18. Diagnosi rapida

### Schermo nero

Controllare:

- loader ancora visibile;
- canvas opaco sopra al video;
- video con `display: none`, dimensioni minime o `z-index` negativo;
- `readyState`;
- `videoWidth` e `videoHeight`;
- errore in `video.error`;
- status dell'asset online.

### Video fermo

Controllare:

- `prefers-reduced-motion` non usato per disabilitare lo scrub;
- `duration` valida;
- track più alta della viewport;
- `currentTime` modificabile;
- seek non bloccato permanentemente su `seeking = true`;
- video codificato con keyframe adeguati.

### Frame avanti e indietro da soli

Controllare:

- inizializzazione eseguita più volte;
- callback `canplay` o `loadeddata` che forza il primo frame;
- due loop che scrivono `currentTime`;
- autoplay ancora attivo;
- React Strict Mode con listener non rimossi.

### Funziona locale ma non online

Controllare:

- commit effettivamente distribuito;
- progetto Pages corretto;
- root directory;
- output `dist`;
- URL e status del video;
- pagina online non appartenente a una vecchia applicazione.

---

## 19. Regole finali

1. Una sola fonte di verità per il tempo: il progresso dello scroll.
2. Un solo seek in volo.
3. Inizializzazione media una sola volta.
4. Video reale sempre presente e full-size.
5. Firefox usa il video nativo.
6. Canvas trasparente e solo quando necessario.
7. Nessun React state nel loop.
8. Nessun easing su `currentTime`.
9. Reduced motion riduce gli effetti, non rompe la funzione.
10. Prima si verifica il deploy, poi si modifica il codice.

Implementazione di riferimento: `ipr-site/src/App.jsx` e `ipr-site/src/App.css`.

---

## 20. Note cross-browser (dal campo)

Lezioni verificate su Chromium, Firefox e WebKit (desktop e mobile).

**Sorgente video per motore.** La scelta è critica per lo scrubbing:

- Safari/WebKit: usare l'**URL diretto**. Un `blob:` rompe il seek su WebKit, che decodifica e cerca in modo affidabile solo da una sorgente reale con Range.
- Chromium/Firefox: usare il **blob** in memoria. Lo scrub via seek non dipende così dalle richieste HTTP Range: su un server senza Range (es. quello di sviluppo) Chromium **non** riesce a fare seek dall'URL diretto (`currentTime` resta a 0).

```js
const isAppleWebKit =
  /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua);
```

**Seek bloccato (Firefox, specie mobile/APZ).** Durante lo scroll Firefox può accorpare o scartare un seek **senza emettere `seeked`**, lasciando il flag `seeking = true` per sempre: il video si congela sul primo frame. Difese:

- Watchdog: sblocca il flag se `seeked` non arriva entro ~220 ms.
- Riconciliazione: nel loop, se `seeking` è true ma `video.seeking` è false (dopo ~120 ms), sblocca.

**Scrub mobile guidato da più sorgenti.** iOS Safari e Firefox/APZ rallentano `requestAnimationFrame` durante lo scroll touch. Pilotare il render anche da `scroll` e `touchmove` (passivi) e tenere un **backstop** a bassa frequenza (`setInterval`, ~250 ms) che fa comunque convergere il video alla posizione di scroll.

**Robustezza extra.**

- `pageshow`: al ritorno da bfcache (back/forward mobile) ri-eseguire priming e render.
- Retry: se il media non è pronto dopo qualche secondo, ricaricare una volta dall'URL diretto.

**Debug sul dispositivo.** Un problema solo-mobile non è ispezionabile da remoto: esporre un pannello on-screen (attivo con `?debug`) che mostra `duration`, `readyState`, spazio di scroll, `currentTime`, flag di seek e contatori di `raf`/`scroll`/`touchmove`. Rivela in un colpo a quale stadio si rompe.
