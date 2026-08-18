// Einheitliche Behandlung von Browser-Berechtigungsanfragen (E-Permissions)
// fuers Oekosystem - aktuell nur Kamera (Meals Barcode-Scanner), aber
// bewusst als eigenstaendiges, wiederverwendbares Modul angelegt, damit jede
// kuenftige App mit derselben klaren Fehlerbehandlung arbeitet statt eine
// unbehandelte Promise-Rejection zu riskieren. Genau das war der Bug hinter
// "Barcodescanner geht nicht": startBarcodeScan() rief getUserMedia() ohne
// jede Fehlerbehandlung auf - bei verweigerter Kamera-Berechtigung blieb der
// Scan-Dialog stumm auf "Kamera wird gestartet..." haengen, ohne Fehler,
// ohne Fallback.

/**
 * @param {MediaStreamConstraints} constraints
 * @returns {Promise<{ok:true, stream:MediaStream}|{ok:false, reason:string, message:string}>}
 */
export async function requestCameraAccess(constraints = { video: { facingMode: 'environment' } }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'unsupported', message: 'Kamera-Zugriff wird von diesem Browser nicht unterstützt.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { ok: true, stream };
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError') {
      return { ok: false, reason: 'denied', message: 'Kamera-Zugriff wurde verweigert. Bitte in den Browser-/App-Einstellungen für diese Seite erlauben und erneut versuchen.' };
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return { ok: false, reason: 'no-camera', message: 'Keine Kamera gefunden.' };
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return { ok: false, reason: 'in-use', message: 'Kamera ist bereits durch eine andere App belegt.' };
    }
    return { ok: false, reason: 'error', message: 'Kamera konnte nicht gestartet werden.' };
  }
}
