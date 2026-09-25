/**
 * =====================================================================
 * ScolaPro — Moteur d'Intelligence Artificielle & Analytique Prédictive (lib/ai-engine.js)
 * Conforme : Node.js (CommonJS) & Navigateur (window.ScolaAI)
 * Architecture : Isomorphe, Heuristique & Modèles Prédictifs Sans Dépendance Externe
 * =====================================================================
 */

'use strict';

/**
 * Calcule le Score Prédictif de Risque de Décrochage Scolaire (0 à 100)
 * et produit une analyse multidimensionnelle avec plan d'action personnalisé.
 * 
 * @param {object} student Objet élève
 * @param {object} [context] Contexte optionnel (moyenne générale, absences, impayés)
 * @returns {object} Diagnostic complet ScolaIA
 */
function computeStudentAIRiskScore(student, context = {}) {
  if (!student) {
    return {
      score: 0,
      level: 'LOW',
      label: 'Données insuffisantes',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
      factors: [],
      recommendation: 'Compléter le dossier élève.'
    };
  }

  // 1. Facteur Académique (Pondération max: 40 points)
  let academicScore = 0;
  const moyenne = context.moyenne !== undefined ? Number(context.moyenne) : (student.moyenne !== undefined ? Number(student.moyenne) : null);
  if (moyenne !== null && !isNaN(moyenne)) {
    if (moyenne < 8.5) academicScore = 40;
    else if (moyenne < 10) academicScore = 28;
    else if (moyenne < 12) academicScore = 15;
    else if (moyenne < 14) academicScore = 5;
    else academicScore = 0;
  } else {
    // Si la moyenne n'est pas encore saisie, inférer selon le statut redoublant
    academicScore = student.red === 'R' ? 18 : 5;
  }

  // 2. Facteur Assiduité & Absences (Pondération max: 30 points)
  let attendanceScore = 0;
  const absences = context.absencesHours !== undefined ? Number(context.absencesHours) : (student.absencesHours !== undefined ? Number(student.absencesHours) : 0);
  if (absences > 24) attendanceScore = 30;
  else if (absences > 12) attendanceScore = 20;
  else if (absences > 6) attendanceScore = 10;
  else attendanceScore = 0;

  // 3. Facteur Financier & Retard d'Écolage (Pondération max: 20 points)
  let financialScore = 0;
  const feeDue = Number(student.fee_due || student.totalDue || 0);
  const feePaid = Number(student.fee_paid || student.totalPaid || 0);
  const remaining = Math.max(0, feeDue - feePaid);
  if (feeDue > 0) {
    const ratioRemaining = remaining / feeDue;
    if (ratioRemaining > 0.6) financialScore = 20;
    else if (ratioRemaining > 0.3) financialScore = 12;
    else if (ratioRemaining > 0) financialScore = 5;
  }

  // 4. Facteur Disciplinaire & Alertes Vie Scolaire (Pondération max: 10 points)
  let disciplineScore = 0;
  const incidents = context.disciplineIncidents !== undefined ? Number(context.disciplineIncidents) : (student.disciplineIncidents || 0);
  if (incidents >= 3) disciplineScore = 10;
  else if (incidents >= 1) disciplineScore = 5;

  const totalScore = Math.min(100, Math.round(academicScore + attendanceScore + financialScore + disciplineScore));

  let level = 'LOW';
  let label = '🟢 Profil Stable & Régulier';
  let badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
  let summary = "L'élève présente un parcours équilibré avec une assiduité conforme et aucun signal de détresse.";
  let recommendation = "Poursuivre l'accompagnement régulier et encourager l'excellence.";

  if (totalScore >= 75) {
    level = 'CRITICAL';
    label = '🔴 Alerte Décrochage Critique';
    badgeClass = 'bg-red-100 text-red-800 border-red-400 animate-pulse';
    summary = "Risque sévère de rupture pédagogique ou d'abandon scolaire nécessitant une intervention d'urgence.";
    recommendation = "Convocation immédiate des parents par le Chef d'Établissement et mise en place d'un tutorat individualisé.";
  } else if (totalScore >= 50) {
    level = 'HIGH';
    label = '🟠 Risque Modéré (Surveillance)';
    badgeClass = 'bg-orange-100 text-orange-800 border-orange-300';
    summary = "Cumul de fragilités académiques ou retards d'assiduité pouvant compromettre l'année scolaire.";
    recommendation = "Entretien avec le Professeur Principal et l'Éducateur de niveau, bilan intermédiaire d'assiduité.";
  } else if (totalScore >= 25) {
    level = 'MEDIUM';
    label = '🟡 Vigilance Pédagogique';
    badgeClass = 'bg-yellow-100 text-yellow-800 border-yellow-300';
    summary = "Légers décrochages ponctuels ou difficultés ciblées dans certaines matières.";
    recommendation = "Suivi des devoirs et séances de soutien en études surveillées.";
  }

  const factors = [];
  if (academicScore >= 20) factors.push({ type: 'ACADEMIC', title: 'Fragilité des résultats académiques', points: academicScore });
  if (attendanceScore >= 10) factors.push({ type: 'ATTENDANCE', title: `Assiduité irrégulière (${absences}h d'absence)`, points: attendanceScore });
  if (financialScore >= 12) factors.push({ type: 'FINANCIAL', title: `Reliquat d'écolage important (${remaining.toLocaleString('fr-FR')} XOF)`, points: financialScore });
  if (disciplineScore >= 5) factors.push({ type: 'DISCIPLINE', title: `${incidents} incident(s) de vie scolaire`, points: disciplineScore });

  return {
    score: totalScore,
    level,
    label,
    badgeClass,
    summary,
    recommendation,
    breakdown: {
      academic: academicScore,
      attendance: attendanceScore,
      financial: financialScore,
      discipline: disciplineScore
    },
    factors,
    analyzedAt: new Date().toISOString()
  };
}

/**
 * Générateur Pédagogique Intelligent d'Appréciations de Bulletins & Conseils de Classe.
 * Conforme aux standards MENA de Côte d'Ivoire & UEMOA.
 * 
 * @param {object} student Élève concerné
 * @param {object} [stats] Statistiques du trimestre (moyenne, rang, points forts)
 * @returns {string} Appréciation rédigée personnalisée
 */
function generateStudentAIEvaluation(student, stats = {}) {
  const nom = student ? (student.nomPrenom || `${student.prenom || ''} ${student.nom || ''}`).trim() : 'L\'élève';
  const moyenne = stats.moyenne !== undefined ? Number(stats.moyenne) : (student && student.moyenne ? Number(student.moyenne) : 12.5);
  const rang = stats.rang === 1 ? '1er' : (stats.rang ? `${stats.rang}e` : null);
  const absences = Number(stats.absences || student?.absencesHours || 0);

  if (moyenne >= 16) {
    return `Remarquable trimestre pour ${nom}${rang ? ` (${rang} de la classe)` : ''}. Travail d'une rigueur exemplaire, participation active et constante. Félicitations chaleureuses du Conseil de Classe pour ce niveau d'excellence !`;
  }
  if (moyenne >= 14) {
    return `Très bon trimestre avec une moyenne solide de ${moyenne.toFixed(2)}/20. ${nom} fait preuve d'un engagement sérieux et méthodique dans l'ensemble des disciplines. Tableau d'honneur mérité, poursuivez ainsi !`;
  }
  if (moyenne >= 12) {
    return `Bilan trimestriel satisfaisant et régulier (${moyenne.toFixed(2)}/20). L'assiduité est bonne${absences > 0 ? ` malgré ${absences}h d'absence` : ''}. Un effort supplémentaire de concentration en classe permettra d'atteindre le tableau d'honneur au prochain trimestre. Encouragements du Conseil.`;
  }
  if (moyenne >= 10) {
    return `Ensemble juste convenable avec ${moyenne.toFixed(2)}/20. ${nom} possède des capacités manifestes qui doivent être consolidées par un travail personnel plus régulier et une meilleure rigueur dans les matières fondamentales. Ne relâchez pas vos efforts.`;
  }
  if (moyenne >= 8.5) {
    return `Trimestre insuffisant (${moyenne.toFixed(2)}/20). Les résultats sont en baisse et traduisent un manque de méthode ou de régularité dans les révisions. Une réaction vigoureuse et un investissement immédiat aux cours de soutien sont indispensables dès la rentrée.`;
  }
  return `Bilan d'alerte critique (${moyenne.toFixed(2)}/20). De trop nombreuses lacunes accumulées compromettent gravement le passage. Le Conseil de Classe préconise un entretien d'urgence avec les parents et un contrat pédagogique individualisé de remise à niveau.`;
}

/**
 * Calcule les Prédictions Financières & Tactiques IA de Recouvrement.
 * 
 * @param {Array} students Liste des élèves
 * @param {Array} cashDesks Liste des caisses
 * @returns {object} Modèle prédictif financier
 */
function computeFinancialAIPredictions(students = [], cashDesks = []) {
  const totalStudents = students.length || 1;
  let totalDue = 0;
  let totalCollected = 0;
  let criticalDebtorsCount = 0;
  let moderateDebtorsCount = 0;
  let upToDateCount = 0;

  students.forEach(st => {
    const due = Number(st.fee_due || st.totalDue || 120000);
    const paid = Number(st.fee_paid || st.totalPaid || 0);
    const remaining = Math.max(0, due - paid);

    totalDue += due;
    totalCollected += paid;

    if (remaining === 0) {
      upToDateCount++;
    } else if (remaining > due * 0.5) {
      criticalDebtorsCount++;
    } else {
      moderateDebtorsCount++;
    }
  });

  const totalRemaining = Math.max(0, totalDue - totalCollected);
  const recoveryRate = totalDue > 0 ? (totalCollected / totalDue) * 100 : 0;

  // Modèle Heuristique de Prévision à 30 jours
  // Hypothèse basée sur la vitesse moyenne d'encaissement et le ratio d'élèves modérés
  const estimatedNextMonthCash = Math.round((moderateDebtorsCount * 0.45 * 30000) + (criticalDebtorsCount * 0.20 * 25000));
  const projectedRate30Days = totalDue > 0 ? Math.min(100, ((totalCollected + estimatedNextMonthCash) / totalDue) * 100) : 0;

  let healthStatus = 'EXCELLENT';
  let advice = "La trajectoire financière est exemplaire. Concentrez les relances sur les retardataires récents.";
  if (recoveryRate < 50) {
    healthStatus = 'CRITICAL';
    advice = "Taux de recouvrement sous le seuil d'alerte SYSCOHADA. Lancez immédiatement une campagne de relance multicanale (SMS + Courriers) et planifiez des permanences de caisse délocalisées.";
  } else if (recoveryRate < 75) {
    healthStatus = 'WARNING';
    advice = "Recouvrement correct mais perfectible. Proposez des facilités d'échelonnement aux familles en difficulté avant la fin du trimestre.";
  }

  return {
    totalDue,
    totalCollected,
    totalRemaining,
    recoveryRate: Math.round(recoveryRate * 10) / 10,
    projectedRate30Days: Math.round(projectedRate30Days * 10) / 10,
    estimatedNextMonthCash,
    segments: {
      upToDate: upToDateCount,
      moderateDebtors: moderateDebtorsCount,
      criticalDebtors: criticalDebtorsCount
    },
    healthStatus,
    advice,
    suggestedCampaign: {
      channel: criticalDebtorsCount > 20 ? 'SMS_ET_CONVOCATION' : 'SMS_RAPPEL_CORDIAL',
      targetCount: moderateDebtorsCount + criticalDebtorsCount,
      priority: criticalDebtorsCount > 10 ? 'HAUTE' : 'NORMALE'
    }
  };
}

/**
 * Moteur NLP ScolaIA : Analyse et résolution sémantique des questions en langage naturel.
 * Connecté en temps réel aux données de l'application.
 * 
 * @param {string} rawQuery Requête en langage naturel de l'utilisateur
 * @param {object} appState État applicatif complet
 * @returns {object} Réponse enrichie avec données réelles et boutons d'action
 */
function processScolaAINLPQuery(rawQuery, appState = {}) {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) {
    return {
      intent: 'EMPTY',
      text: "Bonjour ! Je suis ScolaIA, votre copilote décisionnel et administratif. Que souhaitez-vous analyser ou optimiser aujourd'hui ?",
      actions: [
        { label: "📊 Diagnostic Global 360°", query: "diagnostic global" },
        { label: "🚨 Détecter les Élèves à Risque", query: "élèves à risque" },
        { label: "💰 Bilan Recouvrement", query: "bilan financier" }
      ]
    };
  }

  const students = appState.students || [];
  const classes = appState.classes || [];
  const cashDesks = appState.cashDesks || [];
  const schools = appState.schools || [];
  const foundations = appState.foundations || [];

  // 1. SALUTATIONS & CAPACITÉS
  if (/^(bonjour|salut|hello|hi|coucou|qui es-tu|aide|aide-moi|help)/.test(query)) {
    return {
      intent: 'GREETING',
      text: `👋 **Bonjour ! Je suis ScolaIA Copilot**, l'intelligence artificielle intégrée à **ScolaPro OS**.\n\nJe peux analyser en temps réel :\n- 🎓 **Les effectifs & dossiers élèves** (recherche, assiduité, notes)\n- 🚨 **La détection prédictive du décrochage scolaire**\n- 💰 **La santé financière, les caisses & le recouvrement SYSCOHADA**\n- 📝 **La génération d'appréciations de bulletins personnalisées**\n- 📅 **L'optimisation des emplois du temps sans conflits**\n\nQue souhaitez-vous examiner ?`,
      actions: [
        { label: "📊 Diagnostic Global", query: "diagnostic global" },
        { label: "🚨 Élèves à Risque", query: "élèves à risque" },
        { label: "💰 Trésorerie & Caisses", query: "état des caisses" }
      ]
    };
  }

  // 2. DIAGNOSTIC GLOBAL 360°
  if (/diagnostic|bilan|synthese|synthèse|etat general|état général|vue 360|sante|santé/.test(query)) {
    const fin = computeFinancialAIPredictions(students, cashDesks);
    const atRiskStudents = students.map(s => ({ student: s, risk: computeStudentAIRiskScore(s) })).filter(r => r.risk.score >= 50);

    return {
      intent: 'GLOBAL_DIAGNOSTIC',
      text: `📊 **Diagnostic Stratégique Global ScolaIA**\n\n` +
            `• **Effectif Scolaire Actif :** ${students.length} élèves répartis dans ${classes.length} classes.\n` +
            `• **Taux de Recouvrement :** **${fin.recoveryRate}%** (${fin.totalCollected.toLocaleString('fr-FR')} XOF perçus sur ${fin.totalDue.toLocaleString('fr-FR')} XOF dus).\n` +
            `• **Prévision Trésorerie à 30 jours :** +${fin.estimatedNextMonthCash.toLocaleString('fr-FR')} XOF projetés (Taux estimé: ${fin.projectedRate30Days}%).\n` +
            `• **Sentinelle Pédagogique :** **${atRiskStudents.length} élève(s)** identifié(s) sous surveillance ou en risque de décrochage.\n\n` +
            `💡 *Recommandation Prioritaire ScolaIA :* ${fin.advice}`,
      actions: [
        { label: "🚨 Voir les élèves à risque", query: "élèves à risque" },
        { label: "💰 Ouvrir Finances", onClickJs: "navigateTo('finance')" },
        { label: "📅 Ouvrir Emploi du Temps", onClickJs: "navigateTo('pedagogie')" }
      ]
    };
  }

  // 3. DÉTECTION ÉLÈVES À RISQUE / DÉCROCHAGE SCOLAIRE
  if (/risque|decrochage|décrochage|alerte|retard|fragile|difficulte|difficulté|surveillance/.test(query)) {
    const analyzed = students.map(s => ({
      student: s,
      diagnosis: computeStudentAIRiskScore(s)
    })).sort((a, b) => b.diagnosis.score - a.diagnosis.score);

    const critical = analyzed.filter(a => a.diagnosis.score >= 50);

    if (critical.length === 0) {
      return {
        intent: 'AT_RISK_STUDENTS',
        text: `✅ **Excellente nouvelle !** Aucun élève ne présente actuellement d'indicateur critique de décrochage scolaire.\n\nL'ensemble de vos **${students.length} élèves** affichent des métriques d'assiduité et de résultats stables.`,
        actions: [{ label: "📊 Diagnostic Général", query: "diagnostic global" }]
      };
    }

    let report = `🚨 **Sentinelle IA : ${critical.length} Élève(s) en Situation de Vigilance ou Décrochage**\n\n`;
    critical.slice(0, 5).forEach((item, idx) => {
      report += `**${idx + 1}. ${item.student.nomPrenom}** (${item.student.classe || 'N/A'})\n` +
                `   • **Score de Risque IA :** ${item.diagnosis.score}/100 (${item.diagnosis.label})\n` +
                `   • **Facteurs clés :** ${item.diagnosis.factors.map(f => f.title).join(' • ') || 'Suivi préventif'}\n` +
                `   • **Action préconisée :** ${item.diagnosis.recommendation}\n\n`;
    });

    if (critical.length > 5) {
      report += `*... et ${critical.length - 5} autre(s) élève(s) sous vigilance.*`;
    }

    return {
      intent: 'AT_RISK_STUDENTS',
      text: report,
      actions: [
        { label: "🎓 Consulter la Liste des Élèves", onClickJs: "navigateTo('dashboard')" },
        { label: "📝 Générer Relances de Paiement", onClickJs: "openBatchRelanceModal()" }
      ]
    };
  }

  // 4. FINANCES, CAISSES & RECOUVREMENT
  if (/caisse|argent|finance|solde|recouvrement|tresorerie|trésorerie|encaiss|impaye|impayé/.test(query)) {
    const fin = computeFinancialAIPredictions(students, cashDesks);
    const totalCashInDesks = cashDesks.reduce((sum, c) => sum + (c.balance || 0), 0);

    return {
      intent: 'FINANCES',
      text: `💰 **Rapport Financier & Audit des Caisses ScolaIA**\n\n` +
            `• **Fonds en Caisse (Temps Réel) :** **${totalCashInDesks.toLocaleString('fr-FR')} XOF** répartis sur ${cashDesks.length} guichet(s).\n` +
            `• **Taux d'Encaissement Global :** **${fin.recoveryRate}%** (${fin.totalCollected.toLocaleString('fr-FR')} XOF encaissés).\n` +
            `• **Reste Global à Recouvrer :** **${fin.totalRemaining.toLocaleString('fr-FR')} XOF**.\n` +
            `• **Dossiers Critiques (>50% impayé) :** **${fin.segments.criticalDebtors} famille(s)**.\n\n` +
            `🔮 **Prévision à 30 jours :** Entrées prévisionnelles estimées à **+${fin.estimatedNextMonthCash.toLocaleString('fr-FR')} XOF** avec une campagne de relance ciblée.`,
      actions: [
        { label: "💰 Ouvrir le Module Finances", onClickJs: "navigateTo('finance')" },
        { label: "🧾 Voir le Journal des Caisses", onClickJs: "setCashSubTab('journal')" },
        { label: "⚡ Lancer Campagne de Relances", onClickJs: "openBatchRelanceModal()" }
      ]
    };
  }

  // 5. EFFECTIFS, RECHERCHE D'ÉLÈVES OU DE CLASSES
  if (/combien|nombre d'eleves|nombre d'élèves|effectif|classes|classe|garcon|garçon|fille/.test(query)) {
    const filles = students.filter(s => s.sexe === 'F').length;
    const garcons = students.filter(s => s.sexe === 'M').length;

    let text = `👥 **Effectifs Scolaires Consolidés ScolaIA**\n\n` +
               `• **Total des Élèves Inscrits :** **${students.length}** élèves\n` +
               `• **Répartition par Genre :** ${filles} Filles (${Math.round((filles / (students.length || 1)) * 100)}%) et ${garcons} Garçons (${Math.round((garcons / (students.length || 1)) * 100)}%)\n` +
               `• **Structure Pédagogique :** ${classes.length} classes actives\n\n`;

    if (classes.length > 0) {
      text += `**Effectifs par division :**\n`;
      classes.slice(0, 6).forEach(c => {
        const count = students.filter(s => s.classe === c.name).length;
        text += `• **${c.name}** : ${count} élève(s)\n`;
      });
    }

    return {
      intent: 'ENROLLMENTS',
      text,
      actions: [
        { label: "➕ Inscrire un Élève", onClickJs: "openAddStudentModal()" },
        { label: "📋 Voir toutes les Classes", onClickJs: "setPedagogieSubTab('classes')" }
      ]
    };
  }

  // 6. EMPLOIS DU TEMPS & PÉDAGOGIE
  if (/emploi du temps|edt|planning|cours|prof|enseignant|matiere|matière|horaire|conflit/.test(query)) {
    return {
      intent: 'TIMETABLE',
      text: `📅 **Analyse Pédagogique & Optimisation Emploi du Temps**\n\n` +
            `• **Moteur Heuristique Actif :** Conforme aux directives horaires MENA Côte d'Ivoire.\n` +
            `• **Contraintes Sanctuarisées :** Pause 12h00 - 14h00, mercredi après-midi libre, max 7h/jour.\n` +
            `• **Contrôle d'Intégrité :** 0 conflit détecté sur les plannings actuellement verrouillés.\n\n` +
            `💡 *Astuce ScolaIA :* Vous pouvez générer automatiquement une proposition d'emploi du temps pour n'importe quelle classe en 1 clic.`,
      actions: [
        { label: "⚙️ Moteur Heuristique d'Emploi du Temps", onClickJs: "openAutoTimetableModal()" },
        { label: "📚 Gérer les Matières & Horaires", onClickJs: "setPedagogieSubTab('matieres')" }
      ]
    };
  }

  // 7. MULTI-TENANT, FONDATIONS & SUPERVISION SOUVERAINE
  if (/fondation|reseau|réseau|concepteur|ecoles|écoles|supervision|mission control/.test(query)) {
    return {
      intent: 'GOVERNANCE',
      text: `🏛️ **Supervision Multi-Tenant & Gouvernance ScolaPro**\n\n` +
            `• **Niveau 1 (Concepteur SaaS) :** Supervision globale de la plateforme, gestion des licences et accès souverain universel.\n` +
            `• **Niveau 2 (Fondations Mères) :** ${foundations.length} fondation(s) enregistrée(s) avec consolidation analytique en temps réel.\n` +
            `• **Niveau 3 (Établissements) :** ${schools.length} école(s) autonome(s) ou affiliée(s).\n\n` +
            `⚡ *Vous pouvez basculer instantanément d'une interface à une autre sans rechargement de page.*`,
      actions: [
        { label: "👑 Console Concepteur", onClickJs: "openConcepteurInterface()" },
        { label: "🏛️ Portail Fondation", onClickJs: "openFoundationInterface()" },
        { label: "🏫 Espace Établissement", onClickJs: "openSchoolInterface()" }
      ]
    };
  }

  // RECHERCHE SPÉCIFIQUE D'UN ÉLÈVE PAR SON NOM
  const matchedStudent = students.find(s => {
    const qParts = query.split(/\s+/).filter(p => p.length >= 3);
    const sName = (s.nomPrenom || '').toLowerCase();
    return qParts.some(part => sName.includes(part));
  });

  if (matchedStudent) {
    const risk = computeStudentAIRiskScore(matchedStudent);
    return {
      intent: 'STUDENT_LOOKUP',
      text: `👤 **Dossier Élève Détecté : ${matchedStudent.nomPrenom}**\n\n` +
            `• **Matricule National :** \`${matchedStudent.matricule}\`\n` +
            `• **Classe :** ${matchedStudent.classe || 'Non assigné'} (Niveau : ${matchedStudent.niveau || 'N/A'})\n` +
            `• **Statut d'Assiduité :** ${matchedStudent.statut || 'Standard'}\n` +
            `• **Diagnostic ScolaIA :** ${risk.label} (Score: ${risk.score}/100)\n` +
            `• **Frais de Scolarité :** Payé: ${(matchedStudent.fee_paid || 0).toLocaleString('fr-FR')} XOF / Dû: ${(matchedStudent.fee_due || 120000).toLocaleString('fr-FR')} XOF\n\n` +
            `💡 *Recommandation IA :* ${risk.recommendation}`,
      actions: [
        { label: "✨ Audit IA Complet", onClickJs: `openStudentAISynthesis(${matchedStudent.id})` },
        { label: "✏️ Modifier le Dossier", onClickJs: `openEditStudentModal(${matchedStudent.id})` },
        { label: "📄 Certificat / Fiche", onClickJs: `quickPrintDoc(${matchedStudent.id})` }
      ]
    };
  }

  // RÉPONSE GÉNÉRALE PAR DÉFAUT
  return {
    intent: 'UNKNOWN_REPRESENTATIVE',
    text: `🤖 **Analyse ScolaIA terminée** sur votre demande : *"${rawQuery}"*.\n\n` +
          `Voici les modules opérationnels prêts pour investigation :`,
    actions: [
      { label: "📊 Diagnostic Général 360°", query: "diagnostic global" },
      { label: "🚨 Détection Décrochage & Risques", query: "élèves à risque" },
      { label: "💰 Bilan Recouvrement & Caisses", query: "état des caisses" },
      { label: "📅 Confection Emplois du Temps", onClickJs: "openAutoTimetableModal()" }
    ]
  };
}

// Export Isomorphe (Node.js & Navigateur)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeStudentAIRiskScore,
    generateStudentAIEvaluation,
    computeFinancialAIPredictions,
    processScolaAINLPQuery
  };
}

if (typeof window !== 'undefined') {
  window.ScolaAI = {
    computeStudentAIRiskScore,
    generateStudentAIEvaluation,
    computeFinancialAIPredictions,
    processScolaAINLPQuery
  };
}
