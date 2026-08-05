Vendored third-party files for client-side OCR (kein Cloud-Dienst, laeuft
komplett lokal im Browser). Manuell heruntergeladen am 2026-08-05, damit die
App auch offline funktioniert und keine Laufzeit-Abhaengigkeit von einem CDN
besteht.

- `tesseract.min.js`, `worker.min.js` — [tesseract.js](https://github.com/naptha/tesseract.js) v7.0.0, Apache-2.0
- `tesseract-core-lstm.wasm.js` — [tesseract.js-core](https://github.com/naptha/tesseract.js-core) v6.1.2 (LSTM-only, non-SIMD fuer maximale Geraete-Kompatibilitaet), Apache-2.0
- `lang-data/deu.traineddata.gz` — [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) (deutsches Sprachmodell), Apache-2.0

Update: neue Versionen einfach mit denselben Dateinamen ueberschreiben.
