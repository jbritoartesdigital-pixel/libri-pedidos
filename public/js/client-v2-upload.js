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
