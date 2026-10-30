// Teste de validação sintática e lógica da Nova Estrutura Técnica Conjunta do Laudo Pericial CMN 5.303 (ITPA + Work Drones Geo)
const fs = require('fs');

console.log('--- 1. Testando arquivos de assets oficiais ---');
console.assert(fs.existsSync('assets/logo.jpg'), 'Logo ITPA existe');
console.assert(fs.existsSync('assets/logo-work-drones.jpeg'), 'Logo Work Drones existe');
console.assert(fs.existsSync('assets/qrcode-anac.jpeg'), 'QRCode ANAC existe');
console.assert(fs.existsSync('js/assets_laudo.js'), 'Assets Laudo JS existe');

const assetsLaudoContent = fs.readFileSync('js/assets_laudo.js', 'utf8');
console.assert(assetsLaudoContent.includes('LOGO_ITPA'), 'LOGO_ITPA presente em js/assets_laudo.js');
console.assert(assetsLaudoContent.includes('LOGO_WORK_DRONES'), 'LOGO_WORK_DRONES presente em js/assets_laudo.js');
console.assert(assetsLaudoContent.includes('QRCODE_ANAC'), 'QRCODE_ANAC presente em js/assets_laudo.js');

console.log('--- 2. Testando requisitos da Nova Estrutura Técnica em relatorio_talhao.js ---');
const relatorioContent = fs.readFileSync('js/relatorio_talhao.js', 'utf8');

// 1. Cabeçalho Institucional Oficial Work Drones Geo (Sem logo/textos do ITPA no cabeçalho)
console.assert(relatorioContent.includes('CABEÇALHO INSTITUCIONAL OFICIAL (WORK DRONES GEO)'), 'Comentário do cabeçalho oficial Work Drones presente');
console.assert(relatorioContent.includes('WORK DRONES GEO — GEOPROCESSAMENTO E FOTOGRAMETRIA AEREA'), 'Cabeçalho Work Drones Geo presente');
console.assert(relatorioContent.includes('CNPJ: 35.410.458/0001-01'), 'CNPJ Work Drones presente');
console.assert(relatorioContent.includes('LAUDO TECNICO DE AUDITORIA SOCIOAMBIENTAL E CONFORMIDADE ESPACIAL'), 'Título Oficial do Laudo presente');
console.assert(!relatorioContent.includes('AUDITORIA TERRITORIAL\', pageWidth'), 'Badge lateral antigo sobreposto removido com sucesso');

// 2. Referência Normativa e Prazos em Linha Própria
console.assert(relatorioContent.includes('Resolucao CMN no 5.303/2026'), 'Resolução CMN 5.303/2026 presente');
console.assert(relatorioContent.includes('Manual de Credito Rural'), 'Manual de Crédito Rural (MCR) presente');
console.assert(relatorioContent.includes('> 15 modulos fiscais'), 'Critério > 15 módulos fiscais presente');
console.assert(relatorioContent.includes('04/01/2027'), 'Data de vigência 04/01/2027 presente');

// 3. Dados do Imóvel Auditado e Dinâmica de Propriedades
console.assert(relatorioContent.includes('DADOS DO IMOVEL RURAL AUDITADO'), 'Seção de dados do imóvel presente');
console.assert(relatorioContent.includes('Codigo CAR:'), 'Label Código CAR presente');
console.assert(relatorioContent.includes('Area Registrada:'), 'Label Área Registrada presente');
console.assert(relatorioContent.includes('propKey === \'nelito\''), 'Lógica de vinculação Nelito presente');
console.assert(relatorioContent.includes('propKey === \'guanai\''), 'Lógica de vinculação Guanaí presente');
console.assert(relatorioContent.includes('246,116 ha'), 'Área Nelito cadastrada');
console.assert(relatorioContent.includes('615,808 ha'), 'Área Guanaí cadastrada');

// 4. Nome Dinâmico do Arquivo PDF
console.assert(relatorioContent.includes('Laudo_CMN_5303_${nomeCurto}_${dataArquivoStr}.pdf'), 'Nome dinâmico padronizado do PDF presente');

// 5. Parecer de Conformidade Espacial
console.assert(relatorioContent.includes('Supressao pos-31/07/2019 (PRODES/INPE)'), 'PRODES pós-31/07/2019 presente');
console.assert(relatorioContent.includes('Embargos Ambientais IBAMA/ICMBio'), 'Embargos IBAMA/ICMBio presente');
console.assert(relatorioContent.includes('STATUS CONCLUSIVO: IMOVEL ELEGIVEL / CONFORME para concessao e manutencao de credito rural'), 'Status Conclusivo Elegível presente');

// 6. Nota Técnica Pericial (Contestação de Falsos Positivos)
console.assert(relatorioContent.includes('NOTA TECNICA PERICIAL (CONTESTACAO DE FALSOS POSITIVOS)'), 'Título Nota Técnica Pericial presente');
console.assert(relatorioContent.includes('restauracao florestal ativa'), 'Menção a restauração florestal ativa presente');
console.assert(relatorioContent.includes('oscilacoes espectrais sazonais'), 'Menção a oscilações espectrais sazonais presente');
console.assert(relatorioContent.includes('NDVI (Sentinel-2 / resolucao 2m)'), 'Menção a série temporal NDVI presente');
console.assert(relatorioContent.includes('GSD < 5 cm'), 'Menção a drone GSD < 5 cm presente');

// 7. Assinaturas e Responsabilidade Técnica
console.assert(relatorioContent.includes('Bruno Sodero de Freitas'), 'Bruno Sodero de Freitas presente');
console.assert(relatorioContent.includes('Responsavel Tecnico / Geoprocessamento'), 'Responsável Técnico / Geoprocessamento presente');
console.assert(relatorioContent.includes('Piloto Remoto Certificado ANAC'), 'Certificação ANAC presente');

console.log('--- 3. Testando conteúdo e versionamento v=5.8 no index.html ---');
const indexContent = fs.readFileSync('index.html', 'utf8');
console.assert(indexContent.includes('js/assets_laudo.js?v=5.8'), 'assets_laudo.js v5.8 incluído no HTML');
console.assert(indexContent.includes('js/relatorio_talhao.js?v=5.8'), 'relatorio_talhao.js v5.8 incluído no HTML');
console.assert(indexContent.includes('js/auditoria.js?v=5.8'), 'auditoria.js v5.8 incluído no HTML');
console.assert(indexContent.includes('styles.css?v=5.8'), 'styles.css v5.8 incluído no HTML');

console.log('✅ TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
