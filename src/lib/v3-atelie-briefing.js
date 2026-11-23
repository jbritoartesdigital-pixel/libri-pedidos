// Blueprint isolado do briefing Libri Ateliê.
// Ainda NÃO vinculado a pedidos ou uploads. Ativar somente quando a venda
// e a autorização dos responsáveis tiverem integração e testes completos.
export function buildAtelieBriefingBlueprint({
  event={}, packageCode='', contractedApplications=[], requiresChildPhoto=false,
  data={}
}={}) {
  const f=(key,label,type='text',other={})=>({key,label,type,...other});
  const section=(id,title,fields)=>({id,title,fields});
  const safeApplications=Array.isArray(contractedApplications)
    ?contractedApplications.filter(x=>typeof x==='string'&&x.trim()).slice(0,30):[];
  const sections=[
    section('celebracao','Sobre a celebração',[
      f('honoreeName','Nome que aparecerá nas artes','text',
        {prefill:event.honoreeName||''}),
      f('age','Idade, se aplicável','text',
        {required:false}),
      f('occasion','Qual é a ocasião?','text',
        {prefill:event.type||''}),
      f('eventDate','Data da festa','date',
        {prefill:event.date||'',required:false})
    ]),
    section('theme','Tema e personagens',[
      f('theme','Qual é o tema?','text',{required:true}),
      f('interpretation','Como você imagina esse tema?','textarea',
        {hint:'Pode descrever com suas palavras, sem termos de design.'}),
      f('charactersWanted','Personagens ou figuras que gostaria de ver','textarea',{required:false}),
      f('mustHave','Algo que precisa aparecer?','textarea',{required:false}),
      f('mustAvoid','Algo que não pode aparecer?','textarea',{required:false})
    ]),
    section('style','Cores e estilo',[
      f('colorsLiked','Cores que gostaria de usar'),
      f('colorsAvoided','Cores que prefere evitar'),
      f('styleFreedom','Quer escolher o estilo ou deixar a Libri sugerir?','choice',{
        options:['quero escolher','a Libri pode decidir'],required:true
      }),
      ...(data.styleFreedom==='quero escolher'
        ?[f('styleDetails','Que clima ou estilo você imagina?','textarea')]:[])
    ]),
    section('references','Inspirações e referências',[
      f('referenceNotes','O que gostou nas imagens de inspiração?','textarea',
        {required:false,allowsReferenceUploads:true}),
      ...(requiresChildPhoto?[
        f('childPhotoPermission','Autoriza o uso privado das fotos enviadas para criar as artes contratadas?','choice',
          {options:['sim','não'],required:true}),
        ...(data.childPhotoPermission==='sim'
          ?[
            f('guardianAuthorization','Você é responsável legal pela criança ou possui autorização dele para usar estas fotos na criação?','choice',
              {options:['sim','não'],required:true,
                hint:'É apenas para a criação contratada. Não autoriza divulgação ou portfólio.'}),
            ...(data.guardianAuthorization==='sim'
              ?[f('childPhotos','Fotos da criança para criação contratada','upload',
                {required:false,privateOnly:true})]:[])
          ]:[])
      ]:[]),
      f('referenceFiles','Imagens de inspiração','upload',
        {required:false,privateOnly:true}),
    ]),
    section('applications','As artes que você contratou',[
      f('exactTexts','Escreva exatamente os nomes e frases que aparecerão nas artes','textarea',
        {required:true}),
      ...(safeApplications.length?[
        f('applicationsDetails','Para quais artes serão usadas as ilustrações?','textarea',
          {hint:'Aplicações contratadas: '+safeApplications.join(', ')})
      ]:[]),
      f('printingNeeds','Alguma peça contratada será enviada à gráfica?','textarea',
        {required:false,hint:'As medidas e gabaritos só serão pedidos quando necessários.'})
    ]),
    section('permissions','Privacidade',[
      f('portfolioConsent','Autoriza publicar fotos, nome ou artes identificáveis desta festa no portfólio?','choice',{
        options:['não autorizo','quero avaliar uma autorização separada'],
        required:false,prefill:'não autorizo',
        hint:'Não autorizar não impede a produção. Nada será publicado automaticamente.'
      })
    ])
  ];
  return {
    kind:'atelie',schemaVersion:'atelie-draft-0.1',saleReady:false,
    packageCode,sections,
    saveAndResumePlanned:true,
    fileUploadRequiresProtectedCustomerArea:true,
    childDataPrivateByDefault:true,
    portfolioConsentDefault:false,
    inheritedEventOnly:['honoreeName','type','date']
  };
}
