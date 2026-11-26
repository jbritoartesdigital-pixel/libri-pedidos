// Shared pure briefing schema: browser and Worker use the same questions.
const MAX_IMAGE_BYTES=30*1024*1024;
const INTERACTIVE_PRODUCTS =
  new Set([
    'cinematic_interactive',
    'interactive_essential',
    'interactive_animated',
    'interactive_gif',
    'book',
    'infinite',
  ]);

const CINEMATIC_PRODUCTS =
  new Set([
    'cinematic_video',
    'cinematic_interactive',
  ]);

function cleanText(
  value,
  max = 6000,
) {
  return String(
    value ?? '',
  )
    .trim()
    .slice(
      0,
      max,
    );
}

function addonMatches(
  context,
  {
    codes = [],
    prefixes = [],
    terms = [],
  },
) {
  return context.addons.some(
    (addon) => {
      const code =
        String(
          addon.code || '',
        ).toLowerCase();

      const name =
        String(
          addon.name || '',
        )
          .toLowerCase()
          .normalize('NFD')
          .replace(
            /[\u0300-\u036f]/g,
            '',
          );

      return codes.some(
        (item) =>
          code === String(item).toLowerCase(),
      )
      || prefixes.some(
        (item) =>
          code.startsWith(
            String(item).toLowerCase(),
          ),
      )
      || terms.some(
        (item) =>
          name.includes(
            String(item)
              .toLowerCase()
              .normalize('NFD')
              .replace(
                /[\u0300-\u036f]/g,
                '',
              ),
          ),
      );
    },
  );
}

function hasMoments(
  context,
) {
  return addonMatches(
    context,
    {
      prefixes: [
        'moments_',
      ],
      terms: [
        'moments',
      ],
    },
  );
}

function hasConfirmation(
  context,
) {
  return addonMatches(
    context,
    {
      codes: [
        'libri_confirmation',
        'confirmation_libri',
        'rsvp_libri',
      ],
      terms: [
        'confirmacao de presenca libri',
        'confirmacao libri',
      ],
    },
  );
}

function hasFilter(
  context,
) {
  return addonMatches(
    context,
    {
      codes: [
        'custom_filter',
      ],
      terms: [
        'filtro personalizado',
      ],
    },
  );
}

function hasSave(
  context,
) {
  return addonMatches(
    context,
    {
      prefixes: [
        'save_',
        'save-the-date',
      ],
      terms: [
        'save the date',
      ],
    },
  );
}

function hasReminder(
  context,
) {
  return addonMatches(
    context,
    {
      prefixes: [
        'reminder_',
        'lembrete_',
      ],
      terms: [
        'lembrete',
      ],
    },
  );
}

function appearanceLabel(
  context,
) {
  switch (
    context.order.event_type
  ) {
    case 'birthday':
      return 'Você quer que o aniversariante apareça no convite?';

    case '15_years':
      return 'Você quer que a debutante apareça no convite?';

    case 'wedding':
      return 'Vocês querem aparecer no convite?';

    case 'baptism':
      return 'Você quer que a criança apareça no convite?';

    default:
      return 'Você quer que a pessoa celebrada apareça no convite?';
  }
}

function mayAppear(
  data,
) {
  return [
    'yes',
    'libri_decides',
  ].includes(
    data.appearance_choice,
  );
}

function field(
  key,
  label,
  type,
  options = {},
) {
  return {
    key,
    label,
    type,
    required:
      options.required === true,
    help:
      options.help || '',
    placeholder:
      options.placeholder || '',
    options:
      options.options || null,
    min:
      options.min ?? null,
    max:
      options.max ?? null,
    multiple:
      options.multiple === true,
  };
}

function uploadRule(
  fieldKey,
  category,
  min,
  max,
  label,
  help = '',
) {
  return {
    fieldKey,
    category,
    min,
    max,
    label,
    help,
    maxBytes:
      MAX_IMAGE_BYTES,
    accept: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ],
    notesPerFile:
      fieldKey
      === 'reference_files',
  };
}

function visualStyleOptions(
  data,
  eventType,
) {
  // In the simulated briefing, the age can be left blank because advancing
  // through questions does not require submitting the form. Treat an unknown
  // birthday/baptism age as child-oriented until an age is explicitly entered.
  // Known teenage/adult ages must continue using the generic style choices.
  const rawAge = String(data.age ?? '').trim();
  const age = rawAge ? Number(rawAge) : NaN;
  const isChildAge = Number.isInteger(age) && age >= 1 && age <= 12;
  const isChildEventWithoutAge = !Number.isFinite(age)
    && ['birthday', 'baptism'].includes(eventType);

  if (
    isChildAge || isChildEventWithoutAge
  ) {
    return [
      {
        value:
          'stylized_doll',
        label:
          'Bonequinho estilizado',
      },
      {
        value:
          'realistic_detailed',
        label:
          'Realista e detalhado',
      },
      {
        value:
          'libri_decides',
        label:
          'Deixo a Libri decidir',
      },
    ];
  }

  return [
    {
      value:
        'realistic_detailed',
      label:
        'Realista e detalhado',
    },
    {
      value:
        'stylized',
      label:
        'Estilizado',
    },
    {
      value:
        'libri_decides',
      label:
        'Deixo a Libri decidir',
    },
  ];
}

// Schema preview is completely stateless: it never creates an order,
// bypasses payment protection, or persists contact/media details.
export function buildV2BriefingSimulationSchema({ product, eventType, addons = [], data = {} }) {
  if (!product || !/^[a-z0-9_-]{2,80}$/.test(String(product.code || ''))) {
    throw new Error('Selecione um formato válido para visualizar o briefing.');
  }
  if (!['birthday', '15_years', 'wedding', 'celebration', 'other', 'baptism'].includes(eventType)) {
    throw new Error('Escolha um tipo de evento válido.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Dados de simulação inválidos.');
  }
  const context = {
    order: { event_type: eventType },
    product: { code: product.code, name: product.name || 'Seu convite' },
    addons: Array.isArray(addons) ? addons.map(addon => ({
      code: String(addon.code || '').slice(0, 80),
      name: String(addon.name || '').slice(0, 120),
    })) : [],
  };
  return buildSchema(context, data);
}

export function buildSchema(
  context,
  data,
) {
  const sections = [];

  const eventFields = [
    field(
      'event_time',
      'Qual é o horário da festa?',
      'time',
      {
        required:
          true,
      },
    ),

    field(
      'venue_name',
      'Qual é o nome do local?',
      'text',
      {
        required:
          true,
      },
    ),

    field(
      'venue_address',
      'Qual é o endereço do local da festa?',
      'textarea',
      {
        required:
          true,
      },
    ),

    field(
      'theme_or_style',
      'Qual é o tema ou estilo da festa?',
      'text',
      {
        required:
          true,
      },
    ),
  ];

  if (context.order.event_type === 'birthday') {
    eventFields.push(field(
      'joint_celebration',
      'A festa é de irmãos ou de mais de um aniversariante?',
      'choice',
      {
        required:true,
        help:'Dois nomes na mesma festa não significam cobrar duas ilustrações. Personagens ilustrados extras são avaliados separadamente.',
        options:[
          {value:'no',label:'Não, um aniversariante'},
          {value:'yes',label:'Sim, duas ou mais pessoas'}
        ]
      }
    ));
    if(data.joint_celebration==='yes') {
      eventFields.push(field(
        'joint_honorees',
        'Quais são os nomes e idades de cada aniversariante?',
        'textarea',
        {
          required:true,
          help:'Ex.: Ana, 4 anos; Beatriz, 6 anos. O texto do convite pode incluir todos.'
        }
      ));
    } else {
      eventFields.push(field(
        'age',
        'Quantos anos o aniversariante vai fazer?',
        'number',
        {required:true,min:1,max:120}
      ));
    }
  }

  eventFields.push(
    field(
      'special_info',
      'Tem alguma informação especial que eu precise saber?',
      'textarea',
    ),
  );

  sections.push({
    id:
      'event',
    title:
      'Detalhes da festa',
    description:
      'Só o que ainda falta. O que você já informou não precisa ser repetido.',
    fields:
      eventFields,
  });

  const appearanceFields = [
    field(
      'appearance_choice',
      appearanceLabel(
        context,
      ),
      'choice',
      {
        required:
          true,
        options: [
          {
            value:
              'yes',
            label:
              'Sim',
          },
          {
            value:
              'no',
            label:
              'Não',
          },
          {
            value:
              'libri_decides',
            label:
              'Deixo a Libri decidir',
          },
        ],
      },
    ),
  ];

  if (
    mayAppear(data)
  ) {
    const libriChoosesAppearance = data.appearance_choice === 'libri_decides';
    appearanceFields.push(
      field(
        'visual_style',
        'Como você prefere a representação?',
        'choice',
        {
          required:
            !libriChoosesAppearance,
          help: libriChoosesAppearance
            ? 'Opcional: pode deixar o estilo por conta da Libri.'
            : '',
          options:
            visualStyleOptions(data, context.order.event_type),
        },
      ),

      field(
        'outfit_choice',
        'E sobre a roupa?',
        'choice',
        {
          required:
            !libriChoosesAppearance,
          help: libriChoosesAppearance
            ? 'Opcional: a Libri pode decidir se você preferir.'
            : '',
          options: [
            {
              value:
                'send_photo',
              label:
                'Quero enviar foto da roupa',
            },
            {
              value:
                'libri_creates',
              label:
                'A Libri pode criar a roupa',
            },
            {
              value:
                'libri_decides',
              label:
                'Deixo a Libri decidir',
            },
          ],
        },
      ),
    );
  }

  sections.push({
    id:
      'appearance',
    title:
      'Quem aparece no convite',
    fields:
      appearanceFields,
  });

  sections.push({
    id:
      'visual',
    title:
      'Clima visual',
    fields: [
      field(
        'desired_colors',
        'Quais cores você gostaria de ver?',
        'text',
      ),

      field(
        'avoid_colors',
        'Tem alguma cor que você não quer?',
        'text',
      ),

      field(
        'visual_feeling',
        'Que sensação você quer para o convite?',
        'multi_choice',
        {
          required:
            true,
          multiple:
            true,
          max:
            3,
          options: [
            {
              value:
                'joyful',
              label:
                'Alegre',
            },
            {
              value:
                'delicate',
              label:
                'Delicado',
            },
            {
              value:
                'magical',
              label:
                'Mágico',
            },
            {
              value:
                'elegant',
              label:
                'Elegante',
            },
            {
              value:
                'fun',
              label:
                'Divertido',
            },
            {
              value:
                'cinematic',
              label:
                'Cinematográfico',
            },
            {
              value:
                'libri_decides',
              label:
                'Deixo a Libri decidir',
            },
          ],
        },
      ),

      field(
        'must_have',
        'Tem algo que precisa aparecer de qualquer jeito?',
        'textarea',
      ),

      field(
        'must_avoid',
        'Tem algo que você não quer no convite?',
        'textarea',
      ),

      field(
        'exact_text',
        'Existe algum texto que precisa aparecer exatamente como você escreveu?',
        'textarea',
      ),
    ],
  });

  const productFields = [];

  if (
    CINEMATIC_PRODUCTS.has(
      context.product.code,
    )
  ) {
    productFields.push(
      field(
        'speech_preference',
        'Sobre as falas do vídeo:',
        'choice',
        {
          required:
            true,
          help:
            'Você não precisa montar roteiro nem decidir cena por cena.',
          options: [
            {
              value:
                'libri_writes',
              label:
                'A Libri pode criar as falas',
            },
            {
              value:
                'customer_text',
              label:
                'Tenho uma frase ou texto que precisa ser falado',
            },
            {
              value:
                'no_speech',
              label:
                'Prefiro sem fala',
            },
          ],
        },
      ),
    );

    if (
      data.speech_preference
      === 'customer_text'
    ) {
      productFields.push(
        field(
          'speech_text',
          'Qual texto ou frase precisa ser falado?',
          'textarea',
          {
            required:
              true,
          },
        ),
      );
    }
  }

  if (
    INTERACTIVE_PRODUCTS.has(
      context.product.code,
    )
  ) {
    const paidConfirmation =
      hasConfirmation(context);

    productFields.push(
      field(
        'interactive_resources',
        paidConfirmation
          ? 'Quais opções você quer além da Confirmação de Presença Libri?'
          : 'Quais opções você quer no convite?',
        'multi_choice',
        {
          multiple:
            true,
          max:
            paidConfirmation
              ? 2
              : 3,
          help:
            paidConfirmation
              ? 'A Confirmação de Presença Libri já está incluída no pedido.'
              : 'Você pode escolher até 3. As informações normais da festa não contam como opção.',
          options: [
            {
              value:
                'location',
              label:
                'Localização',
            },

            ...(
              paidConfirmation
                ? []
                : [
                  {
                    value:
                      'simple_rsvp',
                    label:
                      'Confirmar presença simples',
                  },
                ]
            ),

            {
              value:
                'gifts',
              label:
                'Presentes',
            },
          ],
        },
      ),


    );

    const resources =
      Array.isArray(
        data.interactive_resources,
      )
        ? data.interactive_resources
        : [];

    if (
      resources.includes(
        'location',
      )
    ) {
      productFields.push(
        field(
          'location_url',
          'Cole o link da localização no Google Maps',
          'url',
          {
            required:
              true,
          },
        ),
      );
    }


  }

  if (context.product.code === 'cinematic_video') {
    productFields.push(field(
      'gift_page_video',
      'Você quer incluir uma página extra de presentes ao final do vídeo?',
      'choice',
      {
        required: true,
        help: 'Esta página aparece depois do convite em vídeo, com as sugestões e/ou os dados Pix que você escolher.',
        options: [
          { value: 'yes', label: 'Sim, quero a página de presentes' },
          { value: 'no', label: 'Não quero incluir' },
        ],
      },
    ));
  }

  const wantsGifts = (
    INTERACTIVE_PRODUCTS.has(context.product.code)
      && Array.isArray(data.interactive_resources)
      && data.interactive_resources.includes('gifts')
  ) || (
    context.product.code === 'cinematic_video'
      && data.gift_page_video === 'yes'
  );

  if (wantsGifts) {
      const wedding =
        context.order.event_type
        === 'wedding';

      productFields.push(
        field(
          'gift_mode',
          wedding
            ? 'Como vocês querem receber presentes?'
            : 'Como você quer organizar os presentes?',
          'choice',
          {
            required:
              true,
            options:
              wedding
                ? [
                  {
                    value:
                      'registry',
                    label:
                      'Lista/site de presentes',
                  },
                  {
                    value:
                      'pix',
                    label:
                      'Pix',
                  },
                  {
                    value:
                      'both',
                    label:
                      'Lista/site + Pix',
                  },
                  {
                    value:
                      'none',
                    label:
                      'Não incluir',
                  },
                ]
                : [
                  {
                    value:
                      'suggestions',
                    label:
                      'Sugestões',
                  },
                  {
                    value:
                      'pix',
                    label:
                      'Pix',
                  },
                  {
                    value:
                      'both',
                    label:
                      'Sugestões + Pix',
                  },
                ],
          },
        ),
      );

      if (
        wedding && ['registry', 'both'].includes(data.gift_mode)
      ) {
        productFields.push(
          field(
            'gift_registry_url',
            'Cole o link da lista/site de presentes',
            'url',
            {
              required:
                true,
            },
          ),
        );
      }

      if (wedding && data.gift_mode === 'both') {
        productFields.push(field(
          'gift_suggestions',
          'Quais sugestões de presente você quer mostrar?',
          'textarea',
          { required: true },
        ));
      }

      if (
        !wedding
        && ['suggestions', 'both'].includes(data.gift_mode)
      ) {
        const categories = Array.isArray(data.gift_categories)
          ? data.gift_categories : [];

        productFields.push(
          field(
            'gift_categories',
            'Que tipos de presentes você gostaria de sugerir?',
            'multi_choice',
            {
              multiple: true,
              required: !cleanText(data.gift_suggestions),
              help: 'Marque todas as opções que desejar. Se já enviou uma lista por escrito, ela continuará valendo.',
              options: [
                { value: 'clothes', label: 'Roupinhas' },
                { value: 'shoes', label: 'Calçados' },
                { value: 'toys', label: 'Brinquedos' },
                { value: 'books', label: 'Livros' },
                { value: 'educational', label: 'Materiais educativos' },
                { value: 'other', label: 'Outros' },
              ],
            },
          ),
        );

        if (categories.includes('clothes')) {
          productFields.push(field(
            'gift_clothing_size',
            'Qual é o tamanho das roupinhas?',
            'text',
            { required: true, help: 'Exemplo: tamanho 2 ou 3 anos.' },
          ));
        }

        if (categories.includes('shoes')) {
          productFields.push(field(
            'gift_shoe_size',
            'Qual é a numeração dos calçados?',
            'text',
            { required: true, help: 'Exemplo: 23/24.' },
          ));
        }

        if (categories.includes('other')) {
          productFields.push(field(
            'gift_other_details',
            'Que outros presentes você gostaria de sugerir?',
            'textarea',
            { required: true },
          ));
        }

        productFields.push(field(
          'gift_suggestions',
          'Quer acrescentar alguma preferência ou sugestão específica?',
          'textarea',
          {
            help: 'Opcional. Pode informar personagens, cores, modelos ou escrever uma lista livre de presentes.',
          },
        ));
      }

      if (
        [
          'pix',
          'both',
        ].includes(
          data.gift_mode,
        )
      ) {
        productFields.push(
          field(
            'pix_key_type',
            'Tipo da chave Pix',
            'choice',
            {
              required:
                true,
              options: [
                {
                  value:
                    'cpf',
                  label:
                    'CPF',
                },
                {
                  value:
                    'cnpj',
                  label:
                    'CNPJ',
                },
                {
                  value:
                    'email',
                  label:
                    'E-mail',
                },
                {
                  value:
                    'phone',
                  label:
                    'Telefone',
                },
                {
                  value:
                    'random',
                  label:
                    'Chave aleatória',
                },
              ],
            },
          ),

          field(
            'pix_key',
            'Chave Pix',
            'text',
            {
              required:
                true,
              help: data.pix_key_type === 'phone'
                ? 'Informe DDD + número. O +55 do Brasil será acrescentado automaticamente. Confirme que este telefone está cadastrado como chave Pix no seu banco.'
                : '',
            },
          ),

          field(
            'pix_holder',
            'Nome do titular da chave',
            'text',
            {
              required:
                true,
            },
          ),

          field(
            'pix_message',
            'Quer deixar uma mensagem junto ao Pix?',
            'textarea',
          ),
        );

        if (data.pix_key_type && cleanText(data.pix_key) && cleanText(data.pix_holder)) {
          productFields.push(field(
            'pix_confirmed',
            'Confira sua chave Pix e o titular. Os dados estão corretos?',
            'choice',
            {
              required: true,
              help: 'Tipo: ' + (data.pix_key_type || '') + ' | Chave: '
                + data.pix_key + ' | Titular: ' + data.pix_holder
                + '. A Libri não confirma a titularidade junto ao banco. Revise com atenção.',
              options: [{ value: 'yes', label: 'Sim, conferi os dados do Pix' }],
            },
          ));
        }
      }
  }

  // All produced invitations can have a musical direction, including
  // cinematic videos. Ask for a specific song only when music is requested.
  if (
    INTERACTIVE_PRODUCTS.has(context.product.code)
    || CINEMATIC_PRODUCTS.has(context.product.code)
  ) {
    productFields.push(
      field(
        'music_choice',
        'Você quer música no convite?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'yes',
              label:
                'Sim',
            },
            {
              value:
                'no',
              label:
                'Não',
            },
            {
              value:
                'libri_decides',
              label:
                'Deixo a Libri decidir',
            },
          ],
        },
      ),
    );

    if (data.music_choice === 'yes') {
      productFields.push(
        field(
          'music_request',
          'Qual música você prefere? (nome ou link)',
          'text',
          {
            help: 'Escreva o nome e o artista ou cole um link. Se não tiver uma música específica, pode deixar em branco para a Libri escolher.',
          },
        ),
      );
    }
  }

  if (
    context.product.code
    === 'book'
  ) {
    productFields.push(
      field(
        'book_important_content',
        'Que conteúdos são importantes para entrar no livro?',
        'textarea',
        {
          required:
            true,
          help:
            'Conte o que precisa aparecer. Você não precisa decidir páginas, posição ou layout.',
        },
      ),
    );
  }

  if (
    context.product.code
    === 'infinite'
  ) {
    productFields.push(
      field(
        'infinite_important_content',
        'Que conteúdos são importantes nessa experiência?',
        'textarea',
        {
          required:
            true,
          help:
            'Pode citar fotos, momentos, história e informações. A Libri organiza a composição.',
        },
      ),

      field(
        'countdown_choice',
        'Você quer contagem regressiva?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'yes',
              label:
                'Sim',
            },
            {
              value:
                'no',
              label:
                'Não',
            },
          ],
        },
      ),
    );
  }

  sections.push({
    id:
      'product',
    title:
      context.product.name
      || 'Seu convite',
    fields:
      productFields,
  });

  const addonFields = [];

  if (
    hasConfirmation(context)
  ) {
    addonFields.push(
      field(
        'rsvp_mode',
        'Como você quer a Confirmação de Presença Libri?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'free',
              label:
                'Livre',
            },
            {
              value:
                'guest_list',
              label:
                'Lista de convidados',
            },
            {
              value:
                'unknown',
              label:
                'Ainda não sei',
            },
          ],
        },
      ),
    );

    if (
      data.rsvp_mode
      === 'guest_list'
    ) {
      addonFields.push(
        field(
          'rsvp_list_behavior',
          'Como funciona a sua lista fechada?',
          'choice',
          {
            required:
              true,
            help:
              'Os nomes e os limites são cadastrados diretamente no aplicativo Libri RSVP. Você não precisa enviar a lista aqui.',
            options: [
              {
                value:
                  'strict',
                label:
                  'Estrita: somente as pessoas cadastradas podem confirmar.',
              },
              {
                value:
                  'flexible',
                label:
                  'Flexível: permite adicionar acompanhantes até o limite definido no aplicativo.',
              },
            ],
          },
        ),
      );
    }
  }

  if (
    hasMoments(context)
  ) {
    addonFields.push(
      field(
        'moments_filter_text',
        'Quer alguma frase ou detalhe específico no filtro do Moments?',
        'text',
        {
          help:
            'O filtro do Álbum da Festa é usado no App Libri.',
        },
      ),
    );
  } else if (
    hasFilter(context)
  ) {
    addonFields.push(
      field(
        'filter_channel',
        'Onde você quer usar o filtro personalizado?',
        'choice',
        {
          required:
            true,
          options: [
            {
              value:
                'instagram',
              label:
                'Instagram',
            },
            {
              value:
                'libri_app',
              label:
                'App Libri',
            },
          ],
        },
      ),

      field(
        'filter_text',
        'Quer alguma frase ou detalhe específico no filtro?',
        'text',
      ),
    );
  }

  if (
    hasSave(context)
  ) {
    addonFields.push(
      field(
        'save_extra_text',
        'O Save the Date precisa de algum texto além dos dados da festa?',
        'textarea',
      ),
    );
  }

  if (
    hasReminder(context)
  ) {
    addonFields.push(
      field(
        'reminder_extra_text',
        'O Lembrete precisa de algum texto específico?',
        'textarea',
      ),
    );
  }

  if (
    addonFields.length
  ) {
    sections.push({
      id:
        'addons',
      title:
        'Adicionais do pedido',
      fields:
        addonFields,
    });
  }

  sections.push({
    id:
      'references',
    title:
      'Referências',
    description:
      'Referências ajudam a mostrar o gosto da festa. Não são modelos prontos para copiar.',
    fields: [
      field(
        'references_note',
        'Quer explicar alguma referência ou inspiração?',
        'textarea',
      ),
    ],
  });

  const uploadRules = [];

  if (
    mayAppear(data)
  ) {
    uploadRules.push(
      uploadRule(
        'person_photos',
        'person',
        data.appearance_choice === 'libri_decides' ? 0 : 2,
        5,
        'Fotos da pessoa que pode aparecer',
        data.appearance_choice === 'libri_decides'
          ? 'Opcional: envie até 5 fotos se quiser que a Libri avalie a inclusão da pessoa.'
          : 'Envie de 2 a 5 fotos nítidas. Não precisa escolher uma favorita.',
      ),
    );

    if (
      data.outfit_choice
      === 'send_photo'
    ) {
      uploadRules.push(
        uploadRule(
          'outfit_photos',
          'outfit',
          1,
          2,
          'Foto da roupa',
          'Envie 1 foto. Se realmente ajudar, pode enviar uma segunda.',
        ),
      );
    }
  }

  uploadRules.push(
    uploadRule(
      'reference_files',
      'reference',
      0,
      6,
      'Referências visuais',
      'Até 6 referências. Cada uma pode receber uma observação.',
    ),
  );

  return {
    version:
      '2.0',
    sections,
    uploadRules,
  };
}

