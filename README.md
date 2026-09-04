<img width="500" height="500" alt="Gemini_Generated_Image_z1yh3pz1yh3pz1yh-removebg-preview" src="https://github.com/user-attachments/assets/da5bf48c-173d-4dca-9de6-6615c87639ac" />


modulo js realizzato per il mio sito portfolio antonionappi.pages.dev (visionabile live come funziona)
js module made specifically for my portfolio dev site antonionappi.pages.dev (see how it works live)
 
 * Copyright (c) 2026 Antonio Nappi. All rights reserved.
 *
 * This file is published for reference only, not for reuse. Copying,
 * redistributing, or incorporating it — in original or modified form,
 * in whole or in part — into another project without prior written
 * permission from the copyright holder is not permitted and constitutes
 * copyright infringement.
 *
 * For licensing requests, contact: antonionappiwork@gmail.com
  

// Lava lamp: simulazione a metaball in WebGL, con fallback a video
// pre-registrato per chi non ha accelerazione hardware.
//
// Come funziona
// -------------
// Il campo di metaball è calcolato interamente sulla GPU: un solo
// triangolo copre lo schermo e un fragment shader valuta, per ogni pixel,
// la somma dei campi di N blob più quello della pozza alla base (vedi
// blobField()/poolField() nel FRAG qui sotto). La CPU si occupa solo della
// fisica: ogni blob attraversa un ciclo esplicito pozza → salita → discesa
// → pozza con tempi ed easing propri — non un'integrazione fisica vera,
// altrimenti potrebbe fermarsi in equilibrio — e la sua posizione/raggio
// vengono scritti in un uniform array che lo shader rilegge a ogni frame.
//
// Se WebGL non è disponibile, o il contesto restituito è renderizzato via
// software (SwiftShader, llvmpipe — capita quando l'accelerazione hardware
// è disattivata a livello di sistema/browser), il modulo rinuncia e mostra
// al suo posto uno dei video pre-registrati in LAVA_CLIPS, più un avviso
// che spiega come riattivare l'accelerazione hardware (vedi
// promptHwAccel()).
//
// Uso: nella pagina serve un <canvas data-lava></canvas> (e, per il
// fallback, un <video data-lava-fallback>) — il modulo si avvia da solo
// cercando quell'attributo. Nessuna dipendenza esterna.
//
// Note di compatibilità:
//   - highp obbligatorio: il campo (r^2/d^2)^2 satura mediump (fp16, max
//     65504) su molte GPU e il risultato sparisce del tutto.
//   - GLSL ES 1.00, così lo stesso shader gira sia su WebGL1 che WebGL2.
//   - niente fwidth(): l'antialiasing usa il gradiente analitico del campo.
//   - gli array uniform vanno cercati come "uBlobs[0]", non col nome nudo.
//
// File statico esterno (non inline): la CSP del sito è script-src 'self'.
