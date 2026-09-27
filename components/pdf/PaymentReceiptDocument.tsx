import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet
} from '@react-pdf/renderer';
import { PaymentReceiptData, formatAmountFCFA } from '../../lib/receipt-utils';

// Styles optimisés pour mise en page A4 contenant deux A5 identiques
const styles = StyleSheet.create({
  page: {
    size: 'A4',
    orientation: 'portrait',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 24,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#0f172a',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff'
  },
  // Conteneur d'un reçu A5 individuel (hauteur ~385pt sur 842pt total A4)
  voucherContainer: {
    height: 382,
    border: '1.5 solid #0f172a',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff'
  },
  // En-tête
  headerRow: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1.5 solid #0f172a',
    paddingBottom: 6
  },
  schoolBlock: {
    width: '65%'
  },
  schoolName: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#0f172a'
  },
  schoolSub: {
    fontSize: 7.5,
    color: '#475569',
    marginTop: 2
  },
  academicYear: {
    fontSize: 7.5,
    color: '#334155',
    fontWeight: 'bold',
    marginTop: 1
  },
  metaBlock: {
    width: '35%',
    alignItems: 'flex-end'
  },
  copyBadgeStudent: {
    backgroundColor: '#dbeafe',
    border: '0.8 solid #93c5fd',
    color: '#1e3a8a',
    fontSize: 7,
    fontWeight: 'bold',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    marginBottom: 4,
    textTransform: 'uppercase'
  },
  copyBadgeAccounting: {
    backgroundColor: '#dcfce7',
    border: '0.8 solid #86efac',
    color: '#14532d',
    fontSize: 7,
    fontWeight: 'bold',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    marginBottom: 4,
    textTransform: 'uppercase'
  },
  receiptNo: {
    fontSize: 9.5,
    fontWeight: 'bold',
    fontFamily: 'Courier',
    backgroundColor: '#f1f5f9',
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 3,
    border: '0.5 solid #cbd5e1'
  },
  dateTimeText: {
    fontSize: 7.5,
    color: '#64748b',
    marginTop: 2
  },
  // Titre
  titleBox: {
    textAlign: 'center',
    paddingVertical: 3,
    borderBottom: '0.5 solid #e2e8f0'
  },
  titleText: {
    fontSize: 9.5,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#0f172a'
  },
  // Grille Élève
  studentGrid: {
    display: 'flex',
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    border: '0.5 solid #e2e8f0',
    borderRadius: 4,
    padding: 6,
    marginVertical: 4
  },
  studentCol: {
    flex: 1
  },
  fieldLabel: {
    fontSize: 6.5,
    textTransform: 'uppercase',
    color: '#64748b',
    fontWeight: 'bold'
  },
  fieldValue: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 1
  },
  fieldValueHighlight: {
    fontSize: 8.5,
    fontWeight: 'bold',
    color: '#1d4ed8',
    marginTop: 1
  },
  // Bloc Versement
  paymentBox: {
    backgroundColor: '#fffbeb',
    border: '0.8 solid #fde68a',
    borderRadius: 4,
    padding: 6,
    marginVertical: 4
  },
  paymentRow: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '0.5 solid #fef3c7',
    paddingBottom: 4,
    marginBottom: 3
  },
  amountFigure: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#047857',
    fontFamily: 'Courier'
  },
  paymentMethod: {
    fontSize: 8,
    fontWeight: 'bold',
    backgroundColor: '#ffffff',
    border: '0.5 solid #fde68a',
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 2
  },
  wordsBlock: {
    fontSize: 7.5,
    color: '#1e293b'
  },
  wordsLabel: {
    fontSize: 6.5,
    textTransform: 'uppercase',
    color: '#64748b',
    fontWeight: 'bold'
  },
  wordsText: {
    fontStyle: 'italic',
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 1
  },
  // Tableau de solde
  balanceTable: {
    border: '0.5 solid #cbd5e1',
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: 3
  },
  tableHeader: {
    display: 'flex',
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottom: '0.5 solid #cbd5e1',
    paddingVertical: 2,
    paddingHorizontal: 4
  },
  tableRow: {
    display: 'flex',
    flexDirection: 'row',
    paddingVertical: 3,
    paddingHorizontal: 4,
    alignItems: 'center'
  },
  thText: {
    fontSize: 6.5,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#475569'
  },
  tdText: {
    fontSize: 8,
    fontFamily: 'Courier',
    fontWeight: 'bold'
  },
  colDue: { width: '28%' },
  colPaid: { width: '28%', textAlign: 'right' },
  colBalance: { width: '28%', textAlign: 'right' },
  colStatus: { width: '16%', textAlign: 'center' },
  // Signatures
  signaturesRow: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: '0.5 solid #e2e8f0',
    paddingTop: 4,
    marginTop: 4
  },
  signatureCol: {
    width: '45%'
  },
  sigLabel: {
    fontSize: 7,
    fontWeight: 'bold',
    color: '#475569'
  },
  sigName: {
    fontSize: 7.5,
    fontWeight: 'bold',
    color: '#0f172a',
    marginTop: 1
  },
  sigBox: {
    height: 24,
    borderBottom: '0.5 dashed #94a3b8',
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sigHint: {
    fontSize: 6,
    color: '#94a3b8',
    fontStyle: 'italic'
  },
  footerLegal: {
    fontSize: 5.5,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 3
  },
  // Ligne de découpe centrale
  cuttingLine: {
    height: 18,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderTop: '1 dashed #94a3b8',
    position: 'relative',
    marginVertical: 2
  },
  cuttingText: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    fontSize: 7.5,
    color: '#64748b',
    fontWeight: 'bold',
    fontFamily: 'Courier',
    marginTop: -8
  }
});

interface VoucherProps {
  data: PaymentReceiptData;
  copyType: 'STUDENT' | 'ACCOUNTING';
}

const SingleReceiptVoucher: React.FC<VoucherProps> = ({ data, copyType }) => {
  const isStudent = copyType === 'STUDENT';
  const copyTitle = isStudent ? 'EXEMPLAIRE ÉLÈVE' : 'EXEMPLAIRE COMPTABILITÉ';
  const badgeStyle = isStudent ? styles.copyBadgeStudent : styles.copyBadgeAccounting;

  const dateStr = typeof data.paidAt === 'string'
    ? data.paidAt
    : (data.paidAt ? new Date(data.paidAt).toLocaleString('fr-FR') : new Date().toLocaleString('fr-FR'));

  const isFullySettled = data.remainingBalance <= 0;

  return (
    <View style={styles.voucherContainer}>
      {/* 1. En-tête */}
      <View>
        <View style={styles.headerRow}>
          <View style={styles.schoolBlock}>
            <Text style={styles.schoolName}>{data.schoolName}</Text>
            <Text style={styles.schoolSub}>
              Code Établissement : {data.schoolCode} • DRENA / MENA • Tél: {data.schoolPhone || '+225 27 20 00 11'}
            </Text>
            <Text style={styles.academicYear}>
              Année Scolaire : {data.schoolYear} • ScolaPro OS
            </Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={badgeStyle}>{copyTitle}</Text>
            <Text style={styles.receiptNo}>{data.receiptNumber}</Text>
            <Text style={styles.dateTimeText}>{dateStr}</Text>
          </View>
        </View>

        {/* 2. Titre */}
        <View style={styles.titleBox}>
          <Text style={styles.titleText}>QUITTANCE DE PAIEMENT DES FRAIS DE SCOLARITÉ</Text>
        </View>

        {/* 3. Élève & Classe */}
        <View style={styles.studentGrid}>
          <View style={[styles.studentCol, { flex: 1.4 }]}>
            <Text style={styles.fieldLabel}>Nom & Prénoms</Text>
            <Text style={styles.fieldValue}>{data.studentName}</Text>
          </View>
          <View style={styles.studentCol}>
            <Text style={styles.fieldLabel}>Matricule</Text>
            <Text style={[styles.fieldValue, { fontFamily: 'Courier' }]}>{data.studentMatricule}</Text>
          </View>
          <View style={styles.studentCol}>
            <Text style={styles.fieldLabel}>Classe</Text>
            <Text style={styles.fieldValueHighlight}>{data.studentClass}</Text>
          </View>
          <View style={styles.studentCol}>
            <Text style={styles.fieldLabel}>Mode Règlement</Text>
            <Text style={styles.fieldValue}>{data.paymentMethod}</Text>
          </View>
        </View>

        {/* 4. Montant & Toutes lettres */}
        <View style={styles.paymentBox}>
          <View style={styles.paymentRow}>
            <View>
              <Text style={styles.fieldLabel}>Montant Encaissé (Ce Versement)</Text>
              <Text style={styles.amountFigure}>{formatAmountFCFA(data.amount)}</Text>
            </View>
            <View>
              <Text style={styles.paymentMethod}>{data.paymentMethod}</Text>
            </View>
          </View>
          <View style={styles.wordsBlock}>
            <Text style={styles.wordsLabel}>Montant en toutes lettres :</Text>
            <Text style={styles.wordsText}>« {data.amountInWords} »</Text>
          </View>
        </View>

        {/* 5. Situation Comptable */}
        <View style={styles.balanceTable}>
          <View style={styles.tableHeader}>
            <View style={styles.colDue}><Text style={styles.thText}>Frais Exigibles</Text></View>
            <View style={styles.colPaid}><Text style={styles.thText}>Cumul Versé</Text></View>
            <View style={styles.colBalance}><Text style={styles.thText}>Reste à Solder</Text></View>
            <View style={styles.colStatus}><Text style={styles.thText}>Situation</Text></View>
          </View>
          <View style={styles.tableRow}>
            <View style={styles.colDue}>
              <Text style={styles.tdText}>{formatAmountFCFA(data.totalDue)}</Text>
            </View>
            <View style={styles.colPaid}>
              <Text style={[styles.tdText, { color: '#047857' }]}>{formatAmountFCFA(data.totalPaidAfter)}</Text>
            </View>
            <View style={styles.colBalance}>
              <Text style={[styles.tdText, { color: isFullySettled ? '#047857' : '#dc2626' }]}>
                {formatAmountFCFA(data.remainingBalance)}
              </Text>
            </View>
            <View style={styles.colStatus}>
              <Text style={{ fontSize: 7, fontWeight: 'bold', color: isFullySettled ? '#047857' : '#b45309' }}>
                {isFullySettled ? 'SOLDÉ' : 'ACOMPTE'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* 6. Signatures et Cachet */}
      <View>
        <View style={styles.signaturesRow}>
          <View style={styles.signatureCol}>
            <Text style={styles.sigLabel}>L'Agent Caissier / Opérateur :</Text>
            <Text style={styles.sigName}>{data.cashierName}</Text>
            <View style={styles.sigBox}>
              <Text style={styles.sigHint}>[Signature & Cachet Caisse]</Text>
            </View>
          </View>
          <View style={[styles.signatureCol, { alignItems: 'flex-end' }]}>
            <Text style={styles.sigLabel}>L'Élève ou Parent / Tuteur Légal :</Text>
            <Text style={styles.sigName}>Pour acquit</Text>
            <View style={[styles.sigBox, { width: '100%' }]}>
              <Text style={styles.sigHint}>[Signature Réceptionnaire]</Text>
            </View>
          </View>
        </View>
        <Text style={styles.footerLegal}>
          Document officiel SYSCOHADA • Empreinte cryptographique ScolaPro OS • {isStudent ? 'À conserver par la famille' : 'Archivage comptabilité établissement'}
        </Text>
      </View>
    </View>
  );
};

export interface PaymentReceiptDocumentProps {
  receipt: PaymentReceiptData;
}

/**
 * Composant Document PDF @react-pdf/renderer
 * Génère 1 page A4 portrait composée de 2 exemplaires A5 avec trait de découpe central.
 */
export const PaymentReceiptDocument: React.FC<PaymentReceiptDocumentProps> = ({ receipt }) => {
  return (
    <Document title={`Quittance-${receipt.receiptNumber}`} author="ScolaPro OS" subject="Quittance de Paiement Scolaire">
      <Page size="A4" style={styles.page}>
        {/* 1er exemplaire : ÉLÈVE */}
        <SingleReceiptVoucher data={receipt} copyType="STUDENT" />

        {/* Ligne de découpe centrale (Ciseaux et tirets) */}
        <View style={styles.cuttingLine}>
          <Text style={styles.cuttingText}>
            ✂ - - - - - - - - - - - - - - - - - Découper ici (Format A5) - - - - - - - - - - - - - - - - - ✂
          </Text>
        </View>

        {/* 2nd exemplaire : COMPTABILITÉ */}
        <SingleReceiptVoucher data={receipt} copyType="ACCOUNTING" />
      </Page>
    </Document>
  );
};

export default PaymentReceiptDocument;
