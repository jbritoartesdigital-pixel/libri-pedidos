export const V2_WHATSAPP_TEMPLATE_KEYS = {
  briefing:
    'whatsapp_template_briefing',
  preview:
    'whatsapp_template_preview',
  balance:
    'whatsapp_template_balance',
  finalized:
    'whatsapp_template_finalized',
};

export const DEFAULT_V2_WHATSAPP_TEMPLATES = {
  briefing:
    'Oi, {cliente}! 💛 Ainda faltam alguns dados do convite de {homenageado}. Quando você terminar de preencher, consigo seguir com a produção. Continue por aqui: {link}?tab=briefing',

  preview:
    'Oi, {cliente}! 💛 A prévia do convite de {homenageado} já está disponível para conferência: {link}?tab=preview',

  balance:
    'Oi, {cliente}! 💛 O pedido {pedido}, de {homenageado}, está com saldo de {saldo} pendente. Os dados estão na sua área: {link}',

  finalized:
    'Oi, {cliente}! 💛 O pedido {pedido}, de {homenageado}, foi finalizado. Obrigada por confiar na Libri Convites! {link}',
};

function cleanTemplate(
  value,
  fallback,
) {
  const text =
    String(
      value
      ?? '',
    )
      .trim()
      .slice(
        0,
        2000,
      );

  return text
    || fallback;
}

export async function loadV2WhatsappTemplates(
  db,
) {
  const keys =
    Object.values(
      V2_WHATSAPP_TEMPLATE_KEYS,
    );

  const result =
    await db
      .prepare(
        `
          SELECT key, value
          FROM v2_settings
          WHERE key IN (?, ?, ?, ?)
        `,
      )
      .bind(
        ...keys,
      )
      .all();

  const saved =
    Object.fromEntries(
      (
        result.results
        || []
      )
        .map(
          (row) => [
            row.key,
            row.value,
          ],
        ),
    );

  return {
    briefing:
      cleanTemplate(
        saved[
          V2_WHATSAPP_TEMPLATE_KEYS
            .briefing
        ],
        DEFAULT_V2_WHATSAPP_TEMPLATES
          .briefing,
      ),

    preview:
      cleanTemplate(
        saved[
          V2_WHATSAPP_TEMPLATE_KEYS
            .preview
        ],
        DEFAULT_V2_WHATSAPP_TEMPLATES
          .preview,
      ),

    balance:
      cleanTemplate(
        saved[
          V2_WHATSAPP_TEMPLATE_KEYS
            .balance
        ],
        DEFAULT_V2_WHATSAPP_TEMPLATES
          .balance,
      ),

    finalized:
      cleanTemplate(
        saved[
          V2_WHATSAPP_TEMPLATE_KEYS
            .finalized
        ],
        DEFAULT_V2_WHATSAPP_TEMPLATES
          .finalized,
      ),
  };
}

export function renderV2WhatsappTemplate(
  template,
  values = {},
) {
  const replacements = {
    cliente:
      values.customerName
      || '',
    homenageado:
      values.honoreeName
      || '',
    pedido:
      values.orderCode
      || '',
    link:
      values.customerAreaUrl
      || '',
    saldo:
      values.balanceLabel
      || '',
  };

  return String(
    template
    || '',
  )
    .replace(/briefing/gi, 'dados do convite')
    .replace(
      /\{(cliente|homenageado|pedido|link|saldo)\}/g,
      (
        _match,
        key,
      ) =>
        String(
          replacements[key]
          || '',
        ),
    )
    .trim();
}
