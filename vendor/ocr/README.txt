OCR local para leer complementos de pago en imagen (Unidades → Documentación).
- tesseract.min.js, worker.min.js: Tesseract.js 5.1.1 (Apache-2.0, LICENSE-tesseract.js.txt)
- tesseract-core-lstm.wasm.js, tesseract-core-simd-lstm.wasm.js: tesseract.js-core 5.1.1 (Apache-2.0, LICENSE-tesseract.js-core.txt)
- spa.traineddata.gz: datos de idioma español (4.0.0_best_int) de @tesseract.js-data/spa 1.0.0 (MIT; modelos de
  tesseract-ocr/tessdata_best, Apache-2.0)
No se precargan con la app (pesan cerca de 10 MB): se descargan la primera vez que se usa el OCR y quedan en la caché
del service worker para usarse sin conexión.
