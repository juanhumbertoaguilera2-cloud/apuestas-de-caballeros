const PDFDocument = require('pdfkit');

const PICK_LABEL = { L: 'Local', E: 'Empate', V: 'Visita' };

// Genera el PDF del comprobante de una quiniela ya llenada y regresa un Buffer.
function buildQuinielaPdfBuffer(entry, quiniela) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const created = new Date(entry.createdAt);
      const fecha = created.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
      const hora = created.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      doc.fontSize(20).text('Apuestas de Caballeros', { align: 'center' });
      doc.fontSize(13).fillColor('#555').text('Comprobante de quiniela', { align: 'center' });
      doc.moveDown(1);

      doc.fillColor('black').fontSize(15).text(quiniela.name, { align: 'center' });
      doc.moveDown(1);

      doc.fontSize(11);
      doc.text(`Usuario: ${entry.username}`);
      doc.text(`Fecha de creación: ${fecha}`);
      doc.text(`Hora: ${hora}`);
      doc.moveDown(1);

      doc.fontSize(12).text('Tus selecciones:', { underline: true });
      doc.moveDown(0.5);
      quiniela.matches.forEach((m, i) => {
        const pick = entry.picks[i];
        const label = PICK_LABEL[pick] || pick;
        const equipo = pick === 'L' ? m.local : pick === 'V' ? m.visita : '';
        doc.fontSize(11).text(`${i + 1}. ${m.local}  vs  ${m.visita}   →   ${label}${equipo ? ' (' + equipo + ')' : ''}`);
      });

      doc.moveDown(1.5);
      doc.fontSize(12).text('Para pagar tu quiniela usa este código:', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(22).fillColor('#9C7530').text(entry.code, { align: 'center' });

      doc.moveDown(1.5);
      doc.fillColor('black').fontSize(11).text('Datos para transferir tu pago:', { align: 'center' });
      doc.fontSize(11).text('Tarjeta (BBVA): 4152 3144 5362 7856', { align: 'center' });
      doc.fontSize(11).text('Dudas y atención a clientes: 33 1532 6743', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildQuinielaPdfBuffer, buildQuinielaReportPdfBuffer };

// Reporte de transparencia: lista de entradas (todas o solo pagadas) con el
// total de apuestas y el dinero acumulado en el pozo.
function buildQuinielaReportPdfBuffer(quiniela, entries, filterLabel) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const now = new Date();
      const cost = quiniela.cost || 0;
      const pozo = cost * entries.length;

      doc.fontSize(20).text('Apuestas de Caballeros', { align: 'center' });
      doc.fontSize(13).fillColor('#555').text('Reporte de transparencia — Quiniela', { align: 'center' });
      doc.moveDown(1);

      doc.fillColor('black').fontSize(15).text(quiniela.name, { align: 'center' });
      doc.fontSize(11).fillColor('#555').text(filterLabel, { align: 'center' });
      doc.moveDown(1);

      doc.fillColor('black').fontSize(10);
      doc.text(`Generado: ${now.toLocaleDateString('es-MX')} ${now.toLocaleTimeString('es-MX')}`);
      doc.moveDown(1);

      doc.fontSize(12).text('Entradas:', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      entries.forEach((e, i) => {
        doc.text(`${i + 1}. ${e.username}   —   Código: ${e.code}   —   ${e.paid ? 'Pagada' : 'No pagada'}`);
      });

      doc.moveDown(1.5);
      doc.fontSize(12).text(`Total de apuestas: ${entries.length}`);
      doc.text(`Costo por boleto: $${cost.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
      doc.fontSize(14).fillColor('#9C7530').text(`Pozo acumulado: $${pozo.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
