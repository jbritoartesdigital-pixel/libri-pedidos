import {
  getV2CustomerPreviewStatus,
  streamV2CustomerPreview,
  approveV2CustomerPreview,
} from '../lib/v2-preview.js';

export async function handleCustomerPreviewV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const listMatch =
    url.pathname
      .match(
        /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/previews$/,
      );

  if (
    listMatch
    && method
    === 'GET'
  ) {
    return getV2CustomerPreviewStatus(
      env,
      listMatch[1],
    );
  }

  const previewMatch =
    url.pathname
      .match(
        /^\/api\/v2\/customer-area\/(ord_[a-f0-9]{36})\/previews\/(\d+)\/(content|approve)$/,
      );

  if (
    !previewMatch
  ) {
    return null;
  }

  const token =
    previewMatch[1];

  const previewId =
    Number.parseInt(
      previewMatch[2],
      10,
    );

  const action =
    previewMatch[3];

  if (
    action
    === 'content'
    && method
    === 'GET'
  ) {
    return streamV2CustomerPreview(
      request,
      env,
      token,
      previewId,
    );
  }

  if (
    action
    === 'approve'
    && method
    === 'POST'
  ) {
    return approveV2CustomerPreview(
      request,
      env,
      token,
      previewId,
    );
  }

  return null;
}
