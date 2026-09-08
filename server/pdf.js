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

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { buildQuinielaPdfBuffer };
