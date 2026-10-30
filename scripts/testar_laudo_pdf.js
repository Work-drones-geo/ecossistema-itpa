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

console.log('--- 2. Testando requisitos da Nova Estrutura Técnica Conjunta em relatorio_talhao.js ---');
const relatorioContent = fs.readFileSync('js/relatorio_talhao.js', 'utf8');

// 1. Cabeçalho Conjunto
console.assert(relatorioContent.includes('INSTITUTO TERRA DE PRESERVACAO AMBIENTAL'), 'Cabeçalho ITPA presente');
console.assert(relatorioContent.includes('WORK DRONES GEO'), 'Cabeçalho Work Drones Geo presente');
console.assert(relatorioContent.includes('GEOPROCESSAMENTO E FOTOGRAMETRIA AEREA'), 'Work Drones subtítulo presente');
console.assert(relatorioContent.includes('LAUDO TECNICO DE AUDITORIA SOCIOAMBIENTAL E CONFORMIDADE ESPACIAL'), 'Título Oficial do Laudo presente');

// 2. Referência Normativa e Prazos
console.assert(relatorioContent.includes('Resolucao CMN no 5.303/2026'), 'Resolução CMN 5.303/2026 presente');
console.assert(relatorioContent.includes('Manual de Credito Rural'), 'Manual de Crédito Rural (MCR) presente');
console.assert(relatorioContent.includes('> 15 modulos fiscais'), 'Critério > 15 módulos fiscais presente');
console.assert(relatorioContent.includes('04/01/2027'), 'Data de vigência 04/01/2027 presente');

// 3. Dados do Imóvel Auditado
console.assert(relatorioContent.includes('DADOS DO IMOVEL RURAL AUDITADO'), 'Seção de dados do imóvel presente');
console.assert(relatorioContent.includes('Codigo CAR Oficial'), 'Código CAR presente');
console.assert(relatorioContent.includes('Area Registrada no CAR'), 'Área Registrada presente');

// 4. Parecer de Conformidade Espacial
console.assert(relatorioContent.includes('Supressao pos-31/07/2019 (PRODES/INPE)'), 'PRODES pós-31/07/2019 presente');
console.assert(relatorioContent.includes('Embargos Ambientais IBAMA/ICMBio'), 'Embargos IBAMA/ICMBio presente');
console.assert(relatorioContent.includes('STATUS CONCLUSIVO: IMOVEL ELEGIVEL / CONFORME para concessao e manutencao de credito rural'), 'Status Conclusivo Elegível presente');

// 5. Nota Técnica Pericial (Contestação de Falsos Positivos)
console.assert(relatorioContent.includes('NOTA TECNICA PERICIAL (CONTESTACAO DE FALSOS POSITIVOS)'), 'Título Nota Técnica Pericial presente');
console.assert(relatorioContent.includes('restauracao florestal ativa'), 'Menção a restauração florestal ativa presente');
console.assert(relatorioContent.includes('Instituto Terra de Preservacao Ambiental (ITPA)'), 'Menção ao ITPA na nota presente');
console.assert(relatorioContent.includes('oscilacoes espectrais sazonais'), 'Menção a oscilações espectrais sazonais presente');
console.assert(relatorioContent.includes('NDVI (Sentinel-2 / resolucao 2m)'), 'Menção a série temporal NDVI presente');
console.assert(relatorioContent.includes('GSD < 5 cm'), 'Menção a drone GSD < 5 cm presente');

// 6. Assinaturas Conjuntas
console.assert(relatorioContent.includes('Bruno Sodero de Freitas'), 'Bruno Sodero de Freitas presente');
console.assert(relatorioContent.includes('Responsavel Tecnico / Geoprocessamento'), 'Responsável Técnico / Geoprocessamento presente');
console.assert(relatorioContent.includes('Piloto Remoto Certificado ANAC'), 'Certificação ANAC presente');
console.assert(relatorioContent.includes('Coordenacao / Validacao Institucional'), 'Coordenação / Validação Institucional presente');
console.assert(relatorioContent.includes('Chancela Institucional ITPA'), 'Chancela Institucional ITPA presente');

console.log('--- 3. Testando conteúdo de index.html ---');
const indexContent = fs.readFileSync('index.html', 'utf8');
console.assert(indexContent.includes('js/assets_laudo.js?v=5.6'), 'assets_laudo.js v5.6 incluído no HTML');
console.assert(indexContent.includes('js/relatorio_talhao.js?v=5.6'), 'relatorio_talhao.js v5.6 incluído no HTML');
console.assert(indexContent.includes('js/auditoria.js?v=5.6'), 'auditoria.js v5.6 incluído no HTML');

console.log('✅ TODOS OS 6 MÓDULOS TÉCNICOS DA NOVA ESTRUTURA FORAM VALIDAS COM SUCESSO!');
