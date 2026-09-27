import { NextRequest, NextResponse } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import React from 'react';
import { PaymentReceiptDocument } from '../../../../components/pdf/PaymentReceiptDocument';
import { PaymentReceiptData, numberToFrenchWordsFCFA, formatAmountFCFA } from '../../../../lib/receipt-utils';

/**
 * Route Handler Next.js (App Router)
 * GET /api/payments/[id]/receipt
 * 
 * Génère et diffuse en continu (streaming) le document PDF A4 Dual-A5 officiel.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paymentId = parseInt(params.id, 10);
    if (isNaN(paymentId) || paymentId <= 0) {
      return NextResponse.json({ error: 'Identifiant de paiement invalide.' }, { status: 400 });
    }

    // Dans une implémentation Supabase / PostgreSQL :
    // const supabase = createServerClient(...);
    // const { data: receiptRow, error } = await supabase.from('receipts').select('*, schools(*)').eq('payment_id', paymentId).single();

    // Modèle de données normalisé pour le rendu PDF
    // (Exemple typé pour consommation directe ou fallback)
    const receiptData: PaymentReceiptData = {
      receiptNumber: `M6-2026-2027-${String(paymentId).padStart(6, '0')}`,
      sequenceNumber: paymentId,
      schoolId: 1,
      schoolCode: 'M6',
      schoolName: 'GROUPE SCOLAIRE MOHAMED 6',
      schoolAddress: 'Abidjan Plateau • République de Côte d\'Ivoire',
      schoolPhone: '+225 27 20 00 11',
      schoolYear: '2026-2027',
      paymentId: paymentId,
      paymentMethod: 'ESPÈCES',
      cashierName: 'KOFFI Adjoua (Caisse Principale)',
      studentId: 701,
      studentName: 'KOUASSI Jean-Marc',
      studentMatricule: '26819402X',
      studentClass: '4ÈME 5',
      amount: 150000,
      amountFormatted: formatAmountFCFA(150000),
      amountInWords: numberToFrenchWordsFCFA(150000),
      totalDue: 200000,
      totalPaidBefore: 0,
      totalPaidAfter: 150000,
      remainingBalance: 50000,
      remainingBalanceFormatted: formatAmountFCFA(50000),
      paidAt: new Date().toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };

    // Rendu en flux binaire PDF natif
    const pdfStream = await renderToStream(
      React.createElement(PaymentReceiptDocument, { receipt: receiptData })
    );

    const filename = `Quittance-${receiptData.receiptNumber}.pdf`;

    return new NextResponse(pdfStream as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Receipt-Number': receiptData.receiptNumber
      }
    });
  } catch (err: any) {
    console.error('Erreur lors de la génération du reçu PDF :', err);
    return NextResponse.json(
      { error: 'Erreur interne lors de la génération du document PDF.', details: err.message },
      { status: 500 }
    );
  }
}
