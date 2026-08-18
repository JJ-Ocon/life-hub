// Barcode-Scan ueber die native Barcode Detection API - kein Vendoring
// noetig. Nicht ueberall verfuegbar (u.a. nicht in Firefox/Safari), daher
// immer mit klarer Erkennung + manuellem Fallback statt eines stillen
// Fehlers. Nutzt bewusst eine echte Kamera-Vorschau (getUserMedia) statt
// eines <input type=file capture>-Fotos - dieses Attribut hat sich in
// dieser App-Familie schon einmal als auf Android-PWAs unzuverlaessig
// erwiesen (siehe E32-Fix in anderen Apps dieses Oekosystems).

import { requestCameraAccess } from '../../shared/permissions.js';

export function barcodeScanSupported() {
  return 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Startet eine Live-Kamera-Erkennung in das gegebene <video>-Element.
 * Bugfix (E-Permissions): scheiterte getUserMedia bisher (z.B. verweigerte
 * Berechtigung), blieb das eine unbehandelte Promise-Rejection - der
 * Aufrufer bekam nie eine Rueckmeldung und der Scan-Dialog haengte
 * schweigend fest. Liefert jetzt IMMER ein Ergebnis-Objekt zurueck,
 * mit `error` gesetzt statt einer geworfenen Exception.
 * @param {HTMLVideoElement} videoEl
 * @param {(code: string) => void} onDetected Wird beim ersten Treffer genau einmal aufgerufen.
 * @returns {Promise<{stop: Function, error: {reason:string, message:string}|null}>}
 */
export async function startBarcodeScan(videoEl, onDetected) {
  const access = await requestCameraAccess();
  if (!access.ok) {
    return { stop: () => {}, error: { reason: access.reason, message: access.message } };
  }
  const stream = access.stream;
  videoEl.srcObject = stream;
  await videoEl.play();

  const detector = new window.BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'],
  });

  let stopped = false;
  let rafId = null;

  async function tick() {
    if (stopped) return;
    try {
      const codes = await detector.detect(videoEl);
      if (codes.length) {
        onDetected(codes[0].rawValue);
        stop();
        return;
      }
    } catch {
      // einzelner Frame kann fehlschlagen (z.B. noch kein Bild) - naechster Tick versucht es erneut
    }
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    stream.getTracks().forEach((t) => t.stop());
  }

  rafId = requestAnimationFrame(tick);
  return { stop, error: null };
}
