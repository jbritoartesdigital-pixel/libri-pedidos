// Same-origin upload with real browser progress. A failed/aborted response
// does not imply the server lost the file, so callers reconcile before retry.
export function uploadCustomerPhoto(url, form, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round(event.loaded * 100 / event.total)));
      }
    };
    xhr.onload = () => {
      let response = xhr.response;
      if (!response || typeof response !== 'object') {
        try { response = JSON.parse(xhr.responseText); } catch { response = null; }
      }
      if (xhr.status >= 200 && xhr.status < 300 && response?.ok) {
        onProgress(100);
        resolve(response.result);
      } else {
        reject(new Error(response?.error || response?.message || 'Não foi possível enviar a foto.'));
      }
    };
    xhr.onerror = () => reject(new Error('Conexão interrompida. Vamos conferir se a foto chegou.'));
    xhr.onabort = () => reject(new Error('Envio interrompido.'));
    xhr.send(form);
  });
}

// The same limits and MIME types enforced by the V2 backend are checked before
// a batch starts, so no partial set is uploaded by accident.
export function planCustomerPhotoBatch(fileList, existingCount, rule) {
  const files = Array.from(fileList || []);
  const remaining = Math.max(0, Number(rule?.max || 0) - Number(existingCount || 0));
  if (!files.length) return { files: [], error: '' };
  if (!rule || files.length > remaining) {
    return {
      files: [],
      error: remaining
        ? `Você pode adicionar no máximo ${remaining} foto(s) neste campo.`
        : 'Você já atingiu o limite de fotos deste campo.',
    };
  }
  const types = new Set(rule.accept || []);
  if (files.some(file => !types.has(String(file.type || '').toLowerCase()))) {
    return { files: [], error: 'Envie somente JPG, PNG, WebP, HEIC ou HEIF.' };
  }
  if (files.some(file => file.size <= 0 || file.size > Number(rule.maxBytes || 0))) {
    return { files: [], error: 'Cada foto deve ter no máximo 30 MB.' };
  }
  return { files, error: '' };
}
