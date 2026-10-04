import {
  downloadV2OrderFolder,
} from '../lib/v2-order-zip.js';

export async function handleAdminOrderZipV2Api(
  request,
  env,
  url,
) {
  const method =
    request.method
      .toUpperCase();

  const match =
    url.pathname
      .match(
        /^\/api\/admin\/v2\/orders\/(LIBRI-\d+)\/download-folder$/,
      );

  if (
    !match
  ) {
    return null;
  }

  if (
    method
    !== 'GET'
  ) {
    return new Response(
      'Method Not Allowed',
      {
        status:
          405,

        headers: {
          allow:
            'GET',
        },
      },
    );
  }

  return downloadV2OrderFolder(
    env,
    match[1],
  );
}
