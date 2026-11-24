// Briefing adaptativo do Ateliê usado na área privada após pagamento.
// Personagens extras são apenas pedidos de orçamento, não itens cobrados automaticamente.
export function buildAtelieBriefingBlueprint({
  event={}, packageCode='', contractedApplications=[], requiresChildPhoto=false,
  data={}
}={}) {
  const f=(key,label,type='text',other={})=>({key,label,type,...other});
  const section=(id,title,fields)=>({id,title,fields});
  const includedPoses=({essencia:1,encanto:2,universo:3})[packageCode]||1;
  const childMascot=data.mascotMode==='criança ilustrada';
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
        {prefill:event.date||'',required:false}),
      f('multipleHonorees','A festa é de dois ou mais homenageados?','choice',{
        options:['não','sim'],required:true,
        hint:'Irmãos celebrando juntos não significam cobrança automática de personagens extras.'
      }),
      ...(data.multipleHonorees==='sim' ? [
        f('honoreesNamesAges','Nomes e idades de cada homenageado','textarea',{required:true})
      ] : [])
    ]),
    section('theme','Tema e personagens',[
      f('theme','Qual é o tema?','text',{required:true}),
      f('interpretation','Como você imagina esse tema?','textarea',
        {hint:'Pode descrever com suas palavras, sem termos de design.'}),
      f('mascotMode','Qual será a ilustração principal da identidade?','choice',{
        options:['criança ilustrada','ilustração temática'],required:true,
        hint:'O pacote inclui uma ilustração principal. Se escolher a criança, pediremos fotos privadas no briefing.'
      }),
      f('includedPosesInfo','Poses incluídas no pacote: '+includedPoses,'info',{
        required:false,
        hint:'Essência: 1 · Encanto: 2 · Universo: 3. Poses extras podem ser orçadas à parte.'
      }),
      f('additionalSubjects','Quer acrescentar outras crianças, animais ou personagens ilustrados?','choice',{
        options:['não','quero solicitar orçamento'],required:true,
        hint:'Cada personagem adicional é orçado separadamente. Não há cobrança automática nem criação antes da aprovação.'
      }),
      ...(data.additionalSubjects==='quero solicitar orçamento' ? [
        f('additionalSubjectsDetails','Quais personagens extras deseja?','textarea',{
          required:true,hint:'Ex.: irmão, cachorro, papagaio ou figura temática. Informe nomes e quantidade.'
        })
      ] : []),
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
      ...(requiresChildPhoto && childMascot?[
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
    kind:'atelie',schemaVersion:'atelie-v4.1-subjects',saleReady:false,
    packageCode,sections,
    saveAndResumePlanned:true,
    fileUploadRequiresProtectedCustomerArea:true,
    childDataPrivateByDefault:true,
    portfolioConsentDefault:false,
    inheritedEventOnly:['honoreeName','type','date']
  };
}
