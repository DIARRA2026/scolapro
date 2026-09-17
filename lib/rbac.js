/**
 * =====================================================================
 * ScolaPro — Contrôle d'Accès Basé sur les Rôles & Multi-Tenant (lib/rbac.js)
 * Module pur : source unique de vérité, sans accès direct à la base de données.
 * =====================================================================
 */

'use strict';

/**
 * Erreur typée d'autorisation avec traçabilité d'audit.
 */
class AccessError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} code
   * @param {string} audit
   */
  constructor(message, status = 403, code = 'ACCESS_DENIED', audit = 'SECURITY_ACCESS_DENIED') {
    super(message);
    this.name = 'AccessError';
    this.status = status;
    this.code = code;
    this.audit = audit;
  }
}

/**
 * Définition normative des rôles applicatifs.
 */
const ROLES = {
  concepteur: {
    role: 'concepteur',
    rank: 1,
    level: 'PLATFORM',
    roleLabel: 'Concepteur Système & Super Admin (INNOVA GROUP)',
    scopeType: 'GLOBAL',
    scopeLabel: 'SOUVERAIN (Global)'
  },
  fondateur: {
    role: 'fondateur',
    rank: 2,
    level: 'FOUNDATION',
    roleLabel: 'Président du Conseil de Fondation',
    scopeType: 'FOUNDATION',
    scopeLabel: 'FONDATION (FEA)'
  },
  admin: {
    role: 'admin',
    rank: 3,
    level: 'SCHOOL',
    roleLabel: 'Proviseur / Administrateur Établissement',
    scopeType: 'SCHOOL',
    scopeLabel: 'Établissement'
  },
  de: {
    role: 'de',
    rank: 3,
    level: 'SCHOOL',
    roleLabel: 'Directeur des Études (D.E / A.C.E)',
    scopeType: 'SCHOOL',
    scopeLabel: 'Établissement'
  },
  cf: {
    role: 'cf',
    rank: 3,
    level: 'SCHOOL',
    roleLabel: 'Chef du Fichier & Scolarité',
    scopeType: 'SCHOOL',
    scopeLabel: 'Établissement'
  },
  educateur: {
    role: 'educateur',
    rank: 3,
    level: 'SCHOOL',
    roleLabel: 'Éducateur de Niveau',
    scopeType: 'CLASSES',
    scopeLabel: 'Divisions Assignées'
  },
  caisse_principale: {
    role: 'caisse_principale',
    rank: 3,
    level: 'SCHOOL',
    roleLabel: 'Responsable Caisse Principale',
    scopeType: 'CASH_DESK',
    scopeLabel: 'Caisse Principale'
  },
  caisse_secondaire: {
    role: 'caisse_secondaire',
    rank: 3,
    level: 'SCHOOL',
    roleLabel: 'Responsable Caisse Secondaire',
    scopeType: 'CASH_DESK',
    scopeLabel: 'Caisse Secondaire (Stricte)'
  },
  consultation: {
    role: 'consultation',
    rank: 3,
    level: 'SCHOOL',
    roleLabel: 'Utilisateur Consultation',
    scopeType: 'SCHOOL',
    scopeLabel: 'Établissement (Lecture Seule)'
  }
};

/**
 * Matrice d'assignation des rôles :
 * - Le concepteur peut assigner tous les rôles.
 * - Le fondateur ne peut assigner que des rôles d'école (rang 3).
 * - L'administrateur d'école peut assigner des rôles de rang 3, sauf le rôle 'admin'.
 * - Tout autre utilisateur ne peut assigner aucun rôle.
 */
const ASSIGNABLE_ROLES = {
  concepteur: ['concepteur', 'fondateur', 'admin', 'de', 'cf', 'educateur', 'caisse_principale', 'caisse_secondaire', 'consultation'],
  fondateur: ['admin', 'de', 'cf', 'educateur', 'caisse_principale', 'caisse_secondaire', 'consultation'],
  admin: ['de', 'cf', 'educateur', 'caisse_principale', 'caisse_secondaire', 'consultation'],
  de: [],
  cf: [],
  educateur: [],
  caisse_principale: [],
  caisse_secondaire: [],
  consultation: []
};

/**
 * Matrice fine des permissions (domaine.action).
 * Seul le concepteur (rang 1) dispose du joker global '*'.
 */
const PERMISSIONS = {
  concepteur: [
    '*',
    'system.superadmin'
  ],
  fondateur: [
    'foundation.view',
    'foundation.schools.view',
    'foundation.manage',
    'foundation.reports',
    'foundation.switch_school',
    'students.view',
    'classes.view',
    'cash.view',
    'reports.view',
    'audit.view'
  ],
  admin: [
    'admin.access',
    'settings.manage',
    'students.view',
    'students.create',
    'students.edit',
    'students.delete',
    'classes.view',
    'classes.create',
    'classes.edit',
    'classes.delete',
    'cash.view',
    'cash.deposit.create',
    'cash.deposit.validate',
    'cash.desk.create',
    'cash.desk.edit',
    'cash.desk.delete',
    'grades.view',
    'grades.edit',
    'reports.view',
    'reports.export',
    'audit.view',
    'ecolage.view',
    'ecolage.manage',
    'payments.view',
    'payments.create',
    'attendance.view',
    'attendance.edit',
    'accounting.view',
    'consultation.view',
    'users.view',
    'users.create',
    'users.edit',
    'users.delete'
  ],
  de: [
    'students.view',
    'students.create',
    'students.edit',
    'classes.view',
    'classes.create',
    'classes.edit',
    'grades.view',
    'grades.edit',
    'attendance.view',
    'attendance.edit',
    'reports.pedagogie',
    'reports.view'
  ],
  cf: [
    'students.view',
    'students.create',
    'students.edit',
    'ecolage.view',
    'reports.fichier',
    'classes.view'
  ],
  educateur: [
    'students.view',
    'attendance.view',
    'attendance.edit',
    'grades.view',
    'classes.view'
  ],
  caisse_principale: [
    'cash.view',
    'cash.deposit.validate',
    'ecolage.view',
    'payments.view',
    'payments.create',
    'students.view'
  ],
  // RÈGLE MÉTIER COMPTABLE : caisse_secondaire peut initier un versement mais NE PEUT PAS le valider.
  caisse_secondaire: [
    'cash.view',
    'cash.deposit.create',
    'ecolage.view',
    'payments.view',
    'payments.create',
    'students.view'
  ],
  consultation: [
    'consultation.view',
    'reports.view',
    'students.view',
    'classes.view'
  ]
};

/**
 * Obtient les permissions d'un rôle.
 * @param {string} role
 * @returns {string[]}
 */
function getRolePermissions(role) {
  return PERMISSIONS[role] ? [...PERMISSIONS[role]] : ['students.view'];
}

/**
 * Vérifie si un utilisateur possède une permission donnée.
 * @param {object} user
 * @param {string} requiredPermission
 * @returns {boolean}
 */
function hasPermission(user, requiredPermission) {
  if (!user || !user.role) return false;
  const userPerms = PERMISSIONS[user.role] || [];
  if (userPerms.includes('*')) return true;
  if (userPerms.includes(requiredPermission)) return true;

  const [domain] = requiredPermission.split('.');
  if (domain && userPerms.includes(`${domain}.*`)) return true;

  return false;
}

/**
 * Lève une AccessError si la permission requise n'est pas accordée.
 * @param {object} user
 * @param {string} requiredPermission
 */
function assertPermission(user, requiredPermission) {
  if (!hasPermission(user, requiredPermission)) {
    throw new AccessError(
      `Permission refusée : l'action '${requiredPermission}' nécessite une habilitation supérieure.`,
      403,
      'PERMISSION_DENIED',
      'SECURITY_UNAUTHORIZED_ACTION'
    );
  }
}

/**
 * Vérifie que le rang de l'utilisateur est suffisant (1 <= maxRankAllowed).
 * @param {object} user
 * @param {number} maxRankAllowed
 */
function assertRank(user, maxRankAllowed) {
  if (!user || !user.role || !ROLES[user.role]) {
    throw new AccessError('Utilisateur non authentifié ou rôle invalide.', 401, 'UNAUTHENTICATED', 'SECURITY_UNAUTHENTICATED');
  }
  const userRank = ROLES[user.role].rank;
  if (userRank > maxRankAllowed) {
    throw new AccessError(
      `Niveau d'autorité insuffisant (Rang ${userRank} vs Rang maximal requis ${maxRankAllowed}).`,
      403,
      'INSUFFICIENT_RANK',
      'SECURITY_HIERARCHY_VIOLATION'
    );
  }
}

/**
 * Vérifie qu'un utilisateur peut assigner un rôle cible lors d'une création ou modification.
 * @param {object} user
 * @param {string} targetRole
 */
function assertCanAssignRole(user, targetRole) {
  if (!user || !user.role) {
    throw new AccessError('Utilisateur non authentifié.', 401, 'UNAUTHENTICATED', 'SECURITY_UNAUTHENTICATED');
  }
  if (!ROLES[targetRole]) {
    throw new AccessError(`Le rôle cible '${targetRole}' n'existe pas.`, 400, 'INVALID_ROLE', 'VALIDATION_ERROR');
  }

  const allowedRoles = ASSIGNABLE_ROLES[user.role] || [];
  if (!allowedRoles.includes(targetRole)) {
    throw new AccessError(
      `Escalade de privilèges interdite : votre rôle '${user.role}' ne peut pas attribuer le rôle '${targetRole}'.`,
      403,
      'ROLE_ASSIGN_FORBIDDEN',
      'SECURITY_PRIVILEGE_ESCALATION'
    );
  }
}

/**
 * Vérifie l'accès à un établissement scolaire donné (Multi-Tenant strict).
 * Injecte la fonction lookupSchool pour rester indépendant de la base de données.
 * @param {object} user
 * @param {number|string} schoolId
 * @param {function} lookupSchool Fonction synchrone (id) => { id, foundation_id, ... }
 */
function assertSchoolAccess(user, schoolId, lookupSchool) {
  if (!user || !user.role) {
    throw new AccessError('Utilisateur non authentifié.', 401, 'UNAUTHENTICATED', 'SECURITY_UNAUTHENTICATED');
  }

  const sId = parseInt(schoolId, 10);
  if (isNaN(sId) || sId <= 0) {
    throw new AccessError('Identifiant d\'établissement invalide.', 400, 'INVALID_SCHOOL_ID', 'VALIDATION_ERROR');
  }

  // 1. Concepteur (Niveau 1 Souverain) : accès global
  if (user.role === 'concepteur') {
    return true;
  }

  // 2. Fondation (Niveau 2) : accès aux écoles affiliées à sa fondation
  if (user.role === 'fondateur') {
    if (!user.foundationId) {
      throw new AccessError('Compte fondation non rattaché à une fondation mère.', 403, 'TENANT_VIOLATION', 'SECURITY_TENANT_BREACH');
    }
    if (typeof lookupSchool !== 'function') {
      throw new AccessError('Fonction de résolution d\'établissement non fournie.', 500, 'INTERNAL_ERROR', 'SYSTEM_ERROR');
    }
    const school = lookupSchool(sId);
    if (!school || Number(school.foundation_id) !== Number(user.foundationId)) {
      throw new AccessError(
        `Accès refusé : l'établissement #${sId} n'est pas affilié à votre fondation (#${user.foundationId}).`,
        403,
        'TENANT_VIOLATION',
        'SECURITY_CROSS_TENANT_ATTEMPT'
      );
    }
    return true;
  }

  // 3. Niveau 3 Établissement : strictement confiné à sa propre école (aucun repli par défaut)
  if (!user.schoolId) {
    throw new AccessError('Compte non rattaché à un établissement scolaire.', 403, 'TENANT_VIOLATION', 'SECURITY_TENANT_BREACH');
  }
  if (Number(user.schoolId) !== sId) {
    throw new AccessError(
      `Accès refusé : vous êtes confiné à l'établissement #${user.schoolId} et tentez d'accéder à l'établissement #${sId}.`,
      403,
      'TENANT_VIOLATION',
      'SECURITY_CROSS_TENANT_ATTEMPT'
    );
  }

  return true;
}

/**
 * Vérifie l'accès à une fondation mère (Niveau 2).
 * @param {object} user
 * @param {number|string} foundationId
 */
function assertFoundationAccess(user, foundationId) {
  if (!user || !user.role) {
    throw new AccessError('Utilisateur non authentifié.', 401, 'UNAUTHENTICATED', 'SECURITY_UNAUTHENTICATED');
  }
  const fId = parseInt(foundationId, 10);
  if (isNaN(fId) || fId <= 0) {
    throw new AccessError('Identifiant de fondation invalide.', 400, 'INVALID_FOUNDATION_ID', 'VALIDATION_ERROR');
  }

  if (user.role === 'concepteur') return true;
  if (user.role === 'fondateur' && Number(user.foundationId) === fId) return true;

  throw new AccessError(
    `Accès refusé à la fondation #${fId} pour le rôle '${user.role}'.`,
    403,
    'TENANT_VIOLATION',
    'SECURITY_TENANT_BREACH'
  );
}

/**
 * Résout l'identifiant d'école cible lors d'une opération d'écriture (création d'élève, encaissement, etc.).
 * Aucun repli implicite vers l'école 1.
 * @param {object} user
 * @param {number|string|undefined} explicitSchoolId
 * @param {function} lookupSchool
 * @returns {number}
 */
function resolveWriteSchoolId(user, explicitSchoolId, lookupSchool) {
  if (!user || !user.role) {
    throw new AccessError('Utilisateur non authentifié.', 401, 'UNAUTHENTICATED', 'SECURITY_UNAUTHENTICATED');
  }

  // Rang 1 Concepteur & Rang 2 Fondateur : l'école cible doit être explicitement désignée
  if (user.role === 'concepteur' || user.role === 'fondateur') {
    if (explicitSchoolId === undefined || explicitSchoolId === null || explicitSchoolId === '') {
      throw new AccessError(
        `L'établissement scolaire cible doit être explicitement spécifié pour le rôle '${user.role}'.`,
        400,
        'EXPLICIT_SCHOOL_REQUIRED',
        'VALIDATION_ERROR'
      );
    }
    const sId = parseInt(explicitSchoolId, 10);
    assertSchoolAccess(user, sId, lookupSchool);
    return sId;
  }

  // Rang 3 Établissement : cible obligatoire et exclusive = user.schoolId
  if (!user.schoolId) {
    throw new AccessError('Compte non rattaché à un établissement.', 403, 'TENANT_VIOLATION', 'SECURITY_TENANT_BREACH');
  }
  const ownSchoolId = parseInt(user.schoolId, 10);
  if (explicitSchoolId !== undefined && explicitSchoolId !== null && explicitSchoolId !== '') {
    const sId = parseInt(explicitSchoolId, 10);
    if (sId !== ownSchoolId) {
      throw new AccessError(
        `Tentative d'écriture trans-tenant détectée : établissement cible #${sId} interdit pour un utilisateur de l'école #${ownSchoolId}.`,
        403,
        'TENANT_CROSS_WRITE',
        'SECURITY_CROSS_TENANT_ATTEMPT'
      );
    }
  }

  return ownSchoolId;
}

module.exports = {
  AccessError,
  ROLES,
  ASSIGNABLE_ROLES,
  PERMISSIONS,
  getRolePermissions,
  hasPermission,
  assertPermission,
  assertRank,
  assertCanAssignRole,
  assertSchoolAccess,
  assertFoundationAccess,
  resolveWriteSchoolId
};
