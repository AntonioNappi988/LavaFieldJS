

modulo js realizzato per il mio sito portfolio **Portfolio:** [antonionappi.pages.dev](https://antonionappi.pages.dev)dev (visionabile live come funziona)

js module made specifically for my portfolio dev site **Portfolio:** [antonionappi.pages.dev](https://antonionappi.pages.dev) (see how it works live)
 
 <p align="center">
  <img src="https://github.com/user-attachments/assets/da5bf48c-173d-4dca-9de6-6615c87639ac" alt="Lava Lamp WebGL Preview" width="350">
</p>

<p align="center">
  <b>Simulazione interattiva a metaball in WebGL con fallback automatico a video.</b><br>
  Sviluppata su misura per il portfolio personalizzato <a href="https://antonionappi.pages.dev">antonionappi.pages.dev</a>.
</p>

<p align="center">
  <a href="https://antonionappi.pages.dev"><img src="https://img.shields.io/badge/Live_Demo-antonionappi.pages.dev-007acc?style=for-the-badge&logo=cloudflare" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/Dependencies-None-brightgreen?style=for-the-badge" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License">
</p>

---

## 📌 Panoramica

Un modulo JavaScript vanilla ad alte prestazioni per la resa grafica di una **Lava Lamp** interattiva. L'algoritmo sfrutta l'accelerazione GPU per calcolare un campo scalare di metaball direttamente nel fragment shader, garantendo framerate elevati anche ad alta risoluzione.

In assenza di supporto GPU o in presenza di un renderer software (es. SwiftShader, llvmpipe), il modulo implementa un sistema di **graceful degradation**, passando a clip video pre-registrate.

---

## 🛠️ Architettura & Tecniche Utilizzate

| Componente | Implementazione & Dettagli Tecnici |
| :--- | :--- |
| **GPU (Fragment Shader)** | Calcola il campo scalare di $N$ blob e della pozza di base (`blobField()` / `poolField()`) per ogni singolo pixel. Coassiale su un unico triangolo *full-screen*. |
| **CPU (Fisica & Stato)** | Gestisce il ciclo di vita dei blob (pozza $\rightarrow$ salita $\rightarrow$ discesa $\rightarrow$ pozza) tramite curve di easing dedicate anziché integrazione numerica continua, prevenendo stalli in punto di equilibrio. Passa posizioni e raggi alla GPU tramite uniform arrays. |
| **Fallback Software** | Rileva contesti WebGL emulati via software e sostituisce il `<canvas>` con un elemento `<video>` sincronizzato (`LAVA_CLIPS`), mostrando un prompt opzionale per l'attivazione dell'accelerazione hardware. |
| **Zero Dipendenze** | Modulo standalone scritto in Pure JavaScript (ES6+) e GLSL ES 1.00. |

---

## ⚡ Note di Compatibilità & Ottimizzazione GLSL

- **`highp` obbligatorio**: Il calcolo del campo $\left(\frac{r^2}{d^2}\right)^2$ richiede alta precisione. L'uso di `mediump` (FP16, max 65504) provocherebbe la saturazione del campo su diverse GPU, rendendo la simulazione invisibile.
- **GLSL ES 1.00**: Garantisce retrocompatibilità nativa sia con **WebGL 1.0** che **WebGL 2.0**.
- **Antialiasing Analitico**: Evita l'uso di `fwidth()` sfruttando il gradiente analitico del campo per mantenere i bordi morbidi senza overhead prestazionale.
- **CSP Compliant**: Predisposto per una Content Security Policy rigida con la direttiva `script-src 'self'`.

---

## 🚀 Guida all'Uso

Il modulo si autoinizializza cercando gli attributi `data-lava` e `data-lava-fallback` nel DOM.

```html
<!-- Canvas principale per il rendering WebGL -->
<canvas data-lava></canvas>

<!-- Elemento di fallback per sistemi privi di accelerazione GPU -->
<video data-lava-fallback playsinline muted loop src="path/to/fallback.mp4"></video>

<!-- Import del modulo statico -->
<script type="module" src="lava-lamp.js"></script>
