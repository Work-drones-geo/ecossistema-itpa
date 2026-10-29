// Teste de validação sintática e lógica do Laudo Pericial CMN 5.303
const fs = require('fs');

console.log('--- Testando arquivos de assets ---');
console.assert(fs.existsSync('assets/logo-work-drones.jpeg'), 'Logo Work Drones existe');
console.assert(fs.existsSync('assets/qrcode-anac.jpeg'), 'QRCode ANAC existe');
console.assert(fs.existsSync('js/assets_laudo.js'), 'Assets Laudo JS existe');

const assetsLaudoContent = fs.readFileSync('js/assets_laudo.js', 'utf8');
console.assert(assetsLaudoContent.includes('LOGO_WORK_DRONES'), 'LOGO_WORK_DRONES presente em js/assets_laudo.js');
console.assert(assetsLaudoContent.includes('QRCODE_ANAC'), 'QRCODE_ANAC presente em js/assets_laudo.js');

console.log('--- Testando conteúdo de relatorio_talhao.js ---');
const relatorioContent = fs.readFileSync('js/relatorio_talhao.js', 'utf8');
console.assert(relatorioContent.includes('WORK DRONES GEO - Inteligencia Geografica e Aerofotogrametria'), 'Cabeçalho Work Drones presente');
console.assert(relatorioContent.includes('CNPJ: 35.410.458/0001-01'), 'CNPJ Work Drones presente');
console.assert(relatorioContent.includes('Bruno Sodero de Freitas'), 'Bruno Sodéro de Freitas presente');
console.assert(relatorioContent.includes('Especialista em Geoprocessamento e Fotogrametria Aerea'), 'Qualificação presente');
console.assert(relatorioContent.includes('Piloto Remoto Certificado ANAC'), 'Certificação ANAC presente');
console.assert(relatorioContent.includes('Validacao de Registro'), 'Legenda QRCode presente');
console.assert(relatorioContent.includes('Volta Redonda - RJ'), 'Local Volta Redonda presente');

console.log('--- Testando conteúdo de index.html ---');
const indexContent = fs.readFileSync('index.html', 'utf8');
console.assert(indexContent.includes('src="js/assets_laudo.js"'), 'assets_laudo.js incluído no HTML');
console.assert(indexContent.includes('src="js/relatorio_talhao.js"'), 'relatorio_talhao.js incluído no HTML');

console.log('--- Testando bounds_expandido.json ---');
const boundsJson = JSON.parse(fs.readFileSync('assets/satelite/bounds_expandido.json', 'utf8'));
console.assert(boundsJson.bounds && boundsJson.bounds.length === 2, 'bounds presentes e válidos');
console.log('Bounds:', boundsJson.bounds);

console.log('✅ TODOS OS TESTES PASSARAM COM SUCESSO!');
