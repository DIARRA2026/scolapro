/**
 * =====================================================================
 * Utilitaires Comptables pour Quittances de Paiement Scolaire (FCFA)
 * Conforme SYSCOHADA / Zone UEMOA
 * =====================================================================
 */

/**
 * Convertit un entier en toutes lettres selon la grammaire française officielle.
 * Gère les accords de pluriel de "vingt", "cent", l'invariabilité de "mille"
 * et l'accord des noms "millions" et "milliards".
 */
export function numberToFrenchWords(n: number): string {
  if (n === 0) return 'zéro';
  if (n < 0) return 'moins ' + numberToFrenchWords(-n);

  const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
  const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];

  function convertBelow1000(val: number, isEnd: boolean): string {
    let res = '';
    const h = Math.floor(val / 100);
    const rem = val % 100;

    if (h > 0) {
      if (h === 1) {
        res += 'cent';
      } else {
        res += units[h] + (rem === 0 && isEnd ? ' cents' : ' cent');
      }
      if (rem > 0) res += ' ';
    }

    if (rem > 0) {
      if (rem < 10) {
        res += units[rem];
      } else if (rem < 20) {
        res += teens[rem - 10];
      } else {
        const t = Math.floor(rem / 10);
        const u = rem % 10;

        if (t === 7) {
          if (u === 1) res += 'soixante et onze';
          else res += 'soixante-' + teens[u];
        } else if (t === 9) {
          res += 'quatre-vingt-' + teens[u];
        } else if (t === 8) {
          if (u === 0) res += isEnd ? 'quatre-vingts' : 'quatre-vingt';
          else res += 'quatre-vingt-' + units[u];
        } else {
          if (u === 1) res += tens[t] + ' et un';
          else if (u > 1) res += tens[t] + '-' + units[u];
          else res += tens[t];
        }
      }
    }
    return res;
  }

  const chunks: string[] = [];
  const scales = [
    { value: 1_000_000_000, singular: 'milliard', plural: 'milliards' },
    { value: 1_000_000, singular: 'million', plural: 'millions' },
    { value: 1_000, singular: 'mille', plural: 'mille' },
    { value: 1, singular: '', plural: '' }
  ];

  let remaining = n;
  for (let i = 0; i < scales.length; i++) {
    const scale = scales[i];
    if (remaining >= scale.value) {
      const count = Math.floor(remaining / scale.value);
      remaining = remaining % scale.value;
      const isEnd = remaining === 0;

      if (scale.value === 1_000) {
        chunks.push(count === 1 ? 'mille' : convertBelow1000(count, false) + ' mille');
      } else if (scale.value >= 1_000_000) {
        const label = count > 1 ? scale.plural : scale.singular;
        chunks.push(convertBelow1000(count, isEnd) + ' ' + label);
      } else {
        chunks.push(convertBelow1000(count, true));
      }
    }
  }

  return chunks.join(' ').trim();
}

/**
 * Convertit un montant en FCFA en toutes lettres avec devise appropriée.
 * Exemple: 150000 -> "Cent cinquante mille Francs CFA"
 */
export function numberToFrenchWordsFCFA(amount: number): string {
  const num = Math.round(Number(amount));
  if (isNaN(num) || num <= 0) return 'Zéro Franc CFA';
  const words = numberToFrenchWords(num);
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  const endsWithMillionOrMilliard = /(million|millions|milliard|milliards)$/i.test(words);
  const prep = endsWithMillionOrMilliard ? 'de ' : '';
  const currency = num === 1 ? 'Franc CFA' : 'Francs CFA';
  return `${capitalized} ${prep}${currency}`;
}

/**
 * Formate un montant entier en FCFA avec séparateur de milliers standard (espace insécable).
 * Exemple: 150000 -> "150 000 FCFA"
 */
export function formatAmountFCFA(amount: number): string {
  const num = Math.round(Number(amount) || 0);
  return `${num.toLocaleString('fr-FR').replace(/\s/g, ' ')} FCFA`;
}

/**
 * Calcule l'année scolaire académique standard (ex: '2026-2027').
 * Bascule en août (mois 8).
 */
export function getCurrentAcademicYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  if (month >= 8) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

/**
 * Structure de données normalisée d'une quittance de paiement.
 */
export interface PaymentReceiptData {
  id?: number | string;
  receiptNumber: string;         // Ex: M6-2026-2027-000123
  sequenceNumber: number;        // Ex: 123
  schoolId: number;
  schoolCode: string;            // Ex: 'M6'
  schoolName: string;            // Ex: 'Groupe Scolaire Mohamed 6'
  schoolAddress?: string;
  schoolPhone?: string;
  schoolLogo?: string;
  schoolYear: string;            // Ex: '2026-2027'
  paymentId?: number | string;
  paymentMethod: string;         // Ex: 'ESPECES', 'MOBILE_MONEY', 'VIREMENT', 'CHEQUE'
  cashierName: string;           // Ex: 'KOFFI Adjoua'
  studentId: number | string;
  studentName: string;           // Ex: 'KOUASSI Jean-Marc'
  studentMatricule: string;      // Ex: '26819402X'
  studentClass: string;          // Ex: '4ÈME 5'
  amount: number;                // En FCFA (ex: 150000)
  amountFormatted: string;       // Ex: '150 000 FCFA'
  amountInWords: string;         // Ex: 'Cent cinquante mille Francs CFA'
  totalDue: number;              // Total exigible
  totalPaidBefore: number;       // Cumul versé avant
  totalPaidAfter: number;        // Cumul versé après
  remainingBalance: number;      // totalDue - totalPaidAfter
  remainingBalanceFormatted: string; // Ex: '50 000 FCFA'
  paidAt: string | Date;
}
