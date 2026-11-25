import {esc} from './admin-v2-core.js';
// Shared private image gallery for legacy and modular order details.
export function orderGalleryHtml(files, contentPath) {
  const labels = {
    person: 'Fotos da pessoa',
    outfit: 'Fotos da roupa',
    reference: 'Inspirações e referências',
  };
  const supported = file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType);

  return `
    <section class="card" id="adminOrderPhotos">
      <div class="section-title">
        <div>
          <h3>Fotos e referências recebidas</h3>
          <small class="order-gallery-hint">Abra cada imagem sem precisar baixar a pasta.</small>
        </div>
        <span class="status">${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}</span>
      </div>
      ${files.length ? `
        <div class="order-photo-grid">
          ${files.map((file, index) => `
            <article class="order-photo-card">
              <button type="button" class="order-photo-open" data-order-photo="${index}"
                aria-label="Ver arquivo ${esc(file.originalFilename)}">
                ${supported(file) ? `
                  <img src="${esc(contentPath(file))}" loading="lazy"
                    alt="${esc(file.fieldLabel || labels[file.category] || 'Foto enviada')}"
                    decoding="async">
                ` : '<span class="order-photo-fallback">Arquivo de imagem</span>'}
              </button>
              <div class="order-photo-details">
                <small>${esc(file.fieldLabel || labels[file.category] || 'Imagem enviada')}</small>
                <strong title="${esc(file.originalFilename)}">${esc(file.originalFilename)}</strong>
                ${file.note ? `<p>${esc(file.note)}</p>` : ''}
                <a class="btn btn-ghost btn-small" href="${esc(contentPath(file))}?download=1">
                  Baixar original
                </a>
              </div>
            </article>
          `).join('')}
        </div>
      ` : '<div class="empty">A cliente ainda não enviou fotos ou referências.</div>'}
      <dialog class="order-photo-viewer" id="orderPhotoViewer" aria-label="Visualização da foto">
        <div class="order-photo-viewer-head">
          <strong id="orderPhotoViewerTitle">Foto enviada</strong>
          <button class="btn btn-ghost" type="button" id="orderPhotoViewerClose">Fechar</button>
        </div>
        <div class="order-photo-viewer-scroll" id="orderPhotoViewerScroll">
          <img id="orderPhotoViewerImg" alt="Foto anexada pela cliente">
        </div>
        <p id="orderPhotoViewerNote"></p>
        <div class="order-photo-viewer-controls">
          <button class="btn btn-ghost" id="orderPhotoPrev" type="button">← Anterior</button>
          <span id="orderPhotoViewerCount" aria-live="polite"></span>
          <button class="btn btn-ghost" id="orderPhotoNext" type="button">Próxima →</button>
          <button class="btn btn-ghost" id="orderPhotoZoom" type="button"
            aria-pressed="false">Ampliar</button>
          <a class="btn btn-secondary" id="orderPhotoViewerDownload" href="#">Baixar original</a>
        </div>
      </dialog>
    </section>
  `;
}

export function bindOrderGallery(root, photos, mediaUrl) {
  const byId = id => root.querySelector('#'+id);
  const photoViewer = byId('orderPhotoViewer');
  const displayable = file => ['image/jpeg', 'image/png', 'image/webp'].includes(file?.mimeType);
  const galleryIndices = photos.map((file, i) => displayable(file) ? i : -1).filter(i => i >= 0);
  let activeGalleryPosition = 0;
  const image = byId('orderPhotoViewerImg');
  const zoom = byId('orderPhotoZoom');
  const scroll = byId('orderPhotoViewerScroll');

  const setZoom = enabled => {
    scroll?.classList.toggle('is-zoomed', enabled);
    zoom?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    if (zoom) zoom.textContent = enabled ? 'Ajustar à tela' : 'Ampliar';
    if (scroll) scroll.scrollTop = scroll.scrollLeft = 0;
  };
  const displayPhoto = position => {
    if (!galleryIndices.length) return;
    activeGalleryPosition = (position + galleryIndices.length) % galleryIndices.length;
    const file = photos[galleryIndices[activeGalleryPosition]];
    const path = mediaUrl(file);
    setZoom(false);
    image.src = path;
    image.alt = file.fieldLabel || file.originalFilename || 'Foto enviada';
    byId('orderPhotoViewerTitle').textContent = file.originalFilename;
    byId('orderPhotoViewerNote').textContent = file.note || '';
    byId('orderPhotoViewerDownload').href = path + '?download=1';
    byId('orderPhotoViewerCount').textContent =
      (activeGalleryPosition + 1) + ' de ' + galleryIndices.length;
    byId('orderPhotoPrev').disabled = galleryIndices.length < 2;
    byId('orderPhotoNext').disabled = galleryIndices.length < 2;
  };
  const movePhoto = step => displayPhoto(activeGalleryPosition + step);

  root.querySelectorAll('[data-order-photo]').forEach(button => {
    button.addEventListener('click', () => {
      const file = photos[Number(button.dataset.orderPhoto)];
      if (!file) return;
      if (!displayable(file) || !photoViewer?.showModal) {
        window.open(mediaUrl(file), '_blank', 'noopener');
        return;
      }
      displayPhoto(galleryIndices.indexOf(Number(button.dataset.orderPhoto)));
      photoViewer.showModal();
    });
  });
  byId('orderPhotoPrev')?.addEventListener('click', () => movePhoto(-1));
  byId('orderPhotoNext')?.addEventListener('click', () => movePhoto(1));
  zoom?.addEventListener('click', () => setZoom(!scroll.classList.contains('is-zoomed')));
  byId('orderPhotoViewerClose')?.addEventListener('click', () => photoViewer?.close());
  photoViewer?.addEventListener('click', event => {
    if (event.target === photoViewer) photoViewer.close();
  });
  photoViewer?.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      movePhoto(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  let touchStart = null;
  scroll?.addEventListener('touchstart', event => {
    if (event.touches.length === 1) {
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
  }, { passive: true });
  scroll?.addEventListener('touchend', event => {
    if (!touchStart || scroll.classList.contains('is-zoomed')) return;
    const dx = event.changedTouches[0].clientX - touchStart.x;
    const dy = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5) movePhoto(dx < 0 ? 1 : -1);
  }, { passive: true });
  photoViewer?.addEventListener('close', () => {
    setZoom(false);
    if (image) image.removeAttribute('src');
  });

}
