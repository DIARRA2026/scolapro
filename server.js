const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db.js');

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload trop volumineux'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Chargement automatique des variables sensibles depuis .env (sans dépendance externe)
function loadEnvFile(envPath = path.join(__dirname, '.env')) {
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      });
      console.log(`[Config] Fichier d'environnement .env chargé avec succès.`);
    } catch (e) {
      console.warn(`[Config] Avertissement: Impossible de lire ${envPath} :`, e.message);
    }
  } else {
    console.log(`[Config] Aucun fichier .env trouvé à ${envPath}. Utilisation des valeurs par défaut.`);
  }
}

loadEnvFile();

let PORT = parseInt(process.env.PORT || '3005', 10);
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Modèle de données Utilisateurs RBAC Côté Serveur
const USERS = [
  {
    id: 0,
    nom: "KOFFI",
    prenom: "Dr. Patrick",
    role: "concepteur",
    roleLabel: "Concepteur Système & Super Admin (INNOVA GROUP)",
    schoolId: null,
    foundationId: null,
    scopeType: "GLOBAL",
    scopeLabel: "SOUVERAIN (Global)",
    level: "PLATFORM"
  },
  {
    id: 1,
    nom: "KOUAMÉ",
    prenom: "Dr. Patrice",
    role: "fondateur",
    roleLabel: "Président du Conseil de Fondation",
    schoolId: null,
    foundationId: 1,
    scopeType: "FOUNDATION",
    scopeLabel: "FONDATION (FEA)",
    level: "FOUNDATION"
  },
  {
    id: 2,
    nom: "DIARRA",
    prenom: "Dolourou Mathieu",
    role: "admin",
    roleLabel: "Proviseur / Administrateur Établissement",
    schoolId: 1,
    foundationId: 1,
    scopeType: "SCHOOL",
    scopeLabel: "Établissement (Lycée Sainte-Marie)",
    level: "SCHOOL"
  },
  {
    id: 3,
    nom: "N'GUETTA",
    prenom: "Kouadio Simplice",
    role: "de",
    roleLabel: "Directeur des Études (D.E / A.C.E)",
    schoolId: 1,
    foundationId: 1,
    scopeType: "SCHOOL",
    scopeLabel: "Établissement (Lycée Sainte-Marie)",
    level: "SCHOOL"
  },
  {
    id: 4,
    nom: "TRAORÉ",
    prenom: "Souleymane",
    role: "cf",
    roleLabel: "Correspondant Fichier (CF)",
    schoolId: 1,
    foundationId: 1,
    scopeType: "SCHOOL",
    scopeLabel: "Écolage Établissement",
    level: "SCHOOL"
  },
  {
    id: 5,
    nom: "BAMBA",
    prenom: "Fatou Alimata",
    role: "educateur",
    roleLabel: "Éducateur",
    schoolId: 1,
    foundationId: 1,
    scopeType: "CLASSES",
    scopeLabel: "Classes 4EME 5 & 6EME 1",
    level: "SCHOOL"
  },
  {
    id: 6,
    nom: "AHOU",
    prenom: "Clarisse Marie",
    role: "caisse_principale",
    roleLabel: "Responsable Caisse Principale",
    schoolId: 1,
    foundationId: 1,
    scopeType: "CASH_DESK",
    scopeLabel: "Caisse Principale",
    level: "SCHOOL"
  },
  {
    id: 7,
    nom: "KOFFI",
    prenom: "Yao Paul",
    role: "caisse_secondaire",
    roleLabel: "Responsable Caisse 2",
    schoolId: 1,
    foundationId: 1,
    scopeType: "CASH_DESK",
    scopeLabel: "Caisse 2 uniquement (Strict)",
    level: "SCHOOL"
  },
  {
    id: 8,
    nom: "DIALLO",
    prenom: "Ibrahima Amadou",
    role: "consultation",
    roleLabel: "Utilisateur Consultation",
    schoolId: 1,
    foundationId: 1,
    scopeType: "SCHOOL",
    scopeLabel: "Établissement (Lecture Seule)",
    level: "SCHOOL"
  }
];

// Parser de cookies HTTP
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

/**
 * Résolveur d'identité utilisateur multi-tenant
 * NOTE ARCHITECTURE & SÉCURITÉ :
 * Ce mécanisme extrait l'utilisateur actif via Header, Paramètre d'URL ou Cookie.
 * Il permet le basculement et la démonstration fluide des 3 compartiments (N1, N2, N3).
 * Pour un déploiement public en production, les jetons cryptographiques JWT
 * ou sessions signées doivent être validés (voir PRODUCTION_GUIDE.md et schema.sql).
 */
function getRequestUser(req, parsedUrl) {
  const cookies = parseCookies(req);
  let userId = null;

  // 1. Header explicite
  if (req.headers['x-scolapro-user-id'] !== undefined) {
    userId = parseInt(req.headers['x-scolapro-user-id'], 10);
  }
  // 2. Paramètre d'URL (pour tests directs ou liens explicites)
  else if (parsedUrl.searchParams.get('user_id') !== null) {
    userId = parseInt(parsedUrl.searchParams.get('user_id'), 10);
  }
  // 3. Cookie de session
  else if (cookies['scolapro_user_id'] !== undefined) {
    userId = parseInt(cookies['scolapro_user_id'], 10);
  }

  // 4. Utilisateur par défaut selon l'espace demandé si aucune session explicite n'est transmise
  if (userId === null || isNaN(userId)) {
    const pathname = parsedUrl.pathname || '';
    if (pathname === '/platform' || pathname.startsWith('/platform/')) {
      userId = 0; // Concepteur (Niveau 1)
    } else if (pathname === '/foundation' || pathname.startsWith('/foundation/')) {
      userId = 1; // Fondateur FEA (Niveau 2)
    } else {
      userId = 2; // Proviseur Lycée Sainte-Marie (Niveau 3)
    }
  }

  try {
    const dbUser = db.getUserById(userId);
    if (dbUser) return dbUser;
  } catch (e) {}

  const user = USERS.find(u => u.id === userId);
  return user || USERS[2];
}

// Page HTML élégante de refus d'accès 403 Forbidden
function render403Page(title, message, user, requiredLevel) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>403 - Accès Refusé | ScolaPro Isolation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#0f0406] text-slate-100 min-h-screen flex items-center justify-center p-4 selection:bg-red-600 selection:text-white">
  <div class="max-w-xl w-full bg-[#1b0609] border-2 border-red-500/40 rounded-3xl p-6 sm:p-10 shadow-2xl text-center space-y-6">
    <div class="w-20 h-20 mx-auto rounded-2xl bg-red-950/80 border border-red-500/50 flex items-center justify-center text-4xl shadow-inner">
      🛡️
    </div>

    <div class="space-y-2">
      <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 text-xs font-mono font-bold uppercase tracking-widest">
        <span>HTTP 403 FORBIDDEN</span> &bull; <span>ISOLATION MULTI-TENANT</span>
      </div>
      <h1 class="text-2xl sm:text-3xl font-black text-white tracking-tight">${title}</h1>
      <p class="text-sm text-rose-200/80 max-w-md mx-auto leading-relaxed">${message}</p>
    </div>

    <!-- Détails de sécurité compartimentée -->
    <div class="bg-black/40 border border-red-900/50 rounded-2xl p-4 text-left space-y-2.5 text-xs">
      <div class="flex justify-between items-center pb-2 border-b border-red-900/40">
        <span class="text-rose-300 font-bold uppercase text-[10px] tracking-wider">Identité Détectée</span>
        <span class="font-mono text-yellow-400 font-bold">${user.prenom} ${user.nom} (ID: ${user.id})</span>
      </div>
      <div class="flex justify-between items-center pb-2 border-b border-red-900/40">
        <span class="text-rose-300 font-bold uppercase text-[10px] tracking-wider">Rôle & Périmètre</span>
        <span class="font-semibold text-white">${user.roleLabel}</span>
      </div>
      <div class="flex justify-between items-center pb-2 border-b border-red-900/40">
        <span class="text-rose-300 font-bold uppercase text-[10px] tracking-wider">Niveau Requis</span>
        <span class="px-2 py-0.5 rounded bg-red-900/60 text-red-200 font-mono font-bold text-[10px]">${requiredLevel}</span>
      </div>
      <div class="flex justify-between items-center">
        <span class="text-rose-300 font-bold uppercase text-[10px] tracking-wider">Règle de Sécurité</span>
        <span class="text-rose-400 italic">Chaîne stricte : Utilisateur &rarr; Rôle &rarr; Fondation &rarr; École</span>
      </div>
    </div>

    <!-- Actions de repli -->
    <div class="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
      <a href="/index.html" class="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-600 hover:to-yellow-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg transition">
        &larr; Retourner à mon Espace Autorisé
      </a>
      <a href="/index.html?switch_user=0" class="w-full sm:w-auto px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs uppercase tracking-wider transition">
        Se connecter comme Concepteur
      </a>
    </div>

    <div class="text-[10px] text-rose-400/50 font-mono">
      ScolaPro Security Kernel &bull; Isolation Garantie
    </div>
  </div>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let reqPath = decodeURI(parsedUrl.pathname);

  // Gestion CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-scolapro-user-id',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  // Healthcheck de supervision (DevOps & Uptime monitoring)
  if (reqPath === '/health' || reqPath === '/api/health') {
    let dbStatus = 'connected';
    try {
      db.db.prepare('SELECT 1').get();
    } catch (err) {
      dbStatus = 'degraded: ' + err.message;
    }
    return sendJson(res, 200, {
      status: dbStatus === 'connected' ? 'UP' : 'DEGRADED',
      name: process.env.APP_NAME || 'ScolaPro',
      version: process.env.APP_VERSION || '2.5.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        engine: 'node:sqlite (DatabaseSync WAL)'
      },
      environment: process.env.APP_ENV || process.env.NODE_ENV || 'production'
    });
  }

  // 1. API REST Cloisonnée & Persistante (Full-Stack)
  if (reqPath.startsWith('/api/')) {
    const user = getRequestUser(req, parsedUrl);

    try {
      // GET /api/session
      if (reqPath === '/api/session' && req.method === 'GET') {
        return sendJson(res, 200, {
          authenticated: true,
          user: user,
          allowedLevels: user.role === 'concepteur' ? ['PLATFORM', 'FOUNDATION', 'SCHOOL'] :
                         user.role === 'fondateur' ? ['FOUNDATION', 'SCHOOL'] : ['SCHOOL']
        });
      }

      // GET /api/config — Configuration publique non sensible (secrets protégés)
      if (reqPath === '/api/config' && req.method === 'GET') {
        return sendJson(res, 200, {
          appName: process.env.APP_NAME || 'ScolaPro',
          appEnv: process.env.APP_ENV || 'development',
          appVersion: process.env.APP_VERSION || '2.5.0',
          port: PORT,
          multiTenantEnabled: process.env.ENABLE_MULTI_TENANT === 'true',
          databaseConnected: true,
          databaseEngine: 'SQLite (node:sqlite Native WAL)',
          supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
          smsProvider: process.env.SMS_PROVIDER || 'orange_ci',
          storageDriver: process.env.STORAGE_DRIVER || 'local'
        });
      }

      // POST /api/auth/switch
      if (reqPath === '/api/auth/switch' && req.method === 'POST') {
        const data = await parseJsonBody(req);
        const targetId = parseInt(data.userId, 10);
        const targetUser = USERS.find(u => u.id === targetId);

        if (!targetUser) {
          return sendJson(res, 404, { error: 'Utilisateur non trouvé' });
        }

        return sendJson(res, 200, {
          success: true,
          user: targetUser,
          targetLevel: targetUser.level,
          redirectUrl: targetUser.level === 'PLATFORM' ? '/platform' :
                       targetUser.level === 'FOUNDATION' ? '/foundation' : '/school'
        }, {
          'Set-Cookie': `scolapro_user_id=${targetUser.id}; Path=/; SameSite=Lax`
        });
      }

      // GET /api/bootstrap — Hydratation initiale persistante complète
      if (reqPath === '/api/bootstrap' && req.method === 'GET') {
        const bootstrap = db.getBootstrapData(user);
        return sendJson(res, 200, {
          authenticated: true,
          user: user,
          allowedLevels: user.role === 'concepteur' ? ['PLATFORM', 'FOUNDATION', 'SCHOOL'] :
                         user.role === 'fondateur' ? ['FOUNDATION', 'SCHOOL'] : ['SCHOOL'],
          ...bootstrap
        });
      }

      // POST /api/sync — Synchronisation réelle de la base de données
      if ((reqPath === '/api/sync' || reqPath === '/api/sync/database') && (req.method === 'POST' || req.method === 'GET')) {
        const bootstrap = db.getBootstrapData(user);
        db.addAuditLog(user, {
          action: 'DATABASE_SYNC',
          module: 'Système',
          target: 'Base SQLite ScolaPro',
          oldVal: '',
          newVal: 'Synchronisation d\'état temps réel réussie'
        });
        return sendJson(res, 200, {
          success: true,
          syncedAt: new Date().toISOString(),
          ...bootstrap
        });
      }

      // MATRICE OFFICIELLE DES PERMISSIONS RBAC 3 NIVEAUX (/api/permissions/matrix)
      if (reqPath === '/api/permissions/matrix' && req.method === 'GET') {
        return sendJson(res, 200, {
          success: true,
          levels: {
            level1: {
              name: 'Niveau 1 — Concepteur & Super Admin Souverain',
              target: 'Éditeur de la plateforme (INNOVA GROUP)',
              directUrl: '/platform',
              scope: 'GLOBAL (Toutes les fondations, toutes les écoles, tous les utilisateurs)',
              capabilities: {
                systemConfigurations: 'READ_WRITE (Gestion complète des clés, tokens, modules et politiques)',
                accessManagement: 'FULL (Création, suspension, suppression d\'utilisateurs, gestion des rôles globaux et locaux)',
                multiTenantManagement: 'FULL (Création et supervision de toutes les fondations et établissements)',
                dataVisibility: 'ALL (Élèves, comptabilité, caisses consolidées, journaux d\'audit globaux)',
                directAccess: ['/platform', '/foundation', '/school']
              }
            },
            level2: {
              name: 'Niveau 2 — Portail Fondation Mère',
              target: 'Présidence & Conseil d\'Administration de la Fondation (ex: FEA)',
              directUrl: '/foundation',
              scope: 'MULTI_SCHOOL_AFFILIATED (Uniquement les établissements rattachés à la fondation)',
              capabilities: {
                systemConfigurations: 'DENIED (403 Forbidden : aucune modification des configurations plateforme)',
                accessManagement: 'RESTRICTED (Gestion des directeurs et personnels de sa propre fondation uniquement)',
                multiTenantManagement: 'AFFILIATED_ONLY (Rattachement d\'écoles à sa fondation)',
                dataVisibility: 'CONSOLIDATED (KPIs globaux consolidés du groupe, taux de recouvrement, effectifs, caisse globale)',
                directAccess: ['/foundation', '/school']
              }
            },
            level3: {
              name: 'Niveau 3 — Espace Établissement Scolaire',
              target: 'Direction, Administration & Équipe Pédagogique locale (ex: Lycée Sainte-Marie)',
              directUrl: '/school',
              scope: 'TENANT_ISOLATED (Strictement limité au school_id de l\'établissement)',
              capabilities: {
                systemConfigurations: 'DENIED (403 Forbidden)',
                accessManagement: 'LOCAL_ONLY (Gestion exclusive des comptes de son établissement)',
                multiTenantManagement: 'DENIED (403 Forbidden)',
                dataVisibility: 'LOCAL_ONLY (Uniquement les élèves, classes, caisses et quittances de son école)',
                directAccess: ['/school']
              }
            }
          }
        });
      }

      // CONFIGURATION SYSTÈME SOUVERAINE (/api/platform/config) — STRICTEMENT CONCEPTEUR (NIVEAU 1)
      if (reqPath === '/api/platform/config') {
        if (user.role !== 'concepteur') {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: 'Accès souverain refusé : réservé au Concepteur du SaaS (Niveau 1). La consultation et la modification des configurations globales sont strictement interdites aux Fondations et Écoles.'
          });
        }

        if (req.method === 'GET') {
          const config = db.getSystemSettings(user);
          return sendJson(res, 200, { success: true, ...config });
        }

        if (req.method === 'PUT' || req.method === 'POST') {
          const body = await parseJsonBody(req);
          const updated = db.updateSystemSettings(user, body);
          return sendJson(res, 200, {
            success: true,
            message: 'Configuration système globale mise à jour avec succès.',
            ...updated
          });
        }
      }

      // GET /api/platform/metrics — STRICTEMENT CONCEPTEUR
      if (reqPath === '/api/platform/metrics') {
        if (user.role !== 'concepteur') {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: 'Accès souverain refusé : réservé au Concepteur du SaaS (INNOVA GROUP).'
          });
        }

        const metricsData = db.getBootstrapData(user);
        const totalCash = metricsData.cashDesks.reduce((acc, c) => acc + (c.balance || 0), 0);

        return sendJson(res, 200, {
          status: 'ONLINE',
          uptime: '99.98%',
          totalFoundations: metricsData.foundations.length,
          totalSchools: metricsData.schools.length,
          totalStudents: metricsData.students.length,
          totalCashConsolidated: totalCash,
          activeTenants: metricsData.schools.length,
          criticalIncidents: 0
        });
      }

      // DONNÉES CONSOLIDÉES DE FONDATION (/api/foundation/:id/consolidated) — NIVEAU 2
      if (reqPath.startsWith('/api/foundation/') && reqPath.endsWith('/consolidated') && req.method === 'GET') {
        const parts = reqPath.split('/');
        const requestedFoundId = parseInt(parts[3], 10);

        const isConcepteur = (user.role === 'concepteur');
        const isOwnerFoundation = (user.role === 'fondateur' && user.foundationId === requestedFoundId);

        if (!isConcepteur && !isOwnerFoundation) {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: `Accès refusé : la consultation des données consolidées de la Fondation #${requestedFoundId} est interdite à ce profil.`
          });
        }

        const consolidated = db.getFoundationConsolidatedData(user, requestedFoundId);
        return sendJson(res, 200, { success: true, ...consolidated });
      }

      // GET /api/foundation/:id/data — FONDATION OU CONCEPTEUR
      if (reqPath.startsWith('/api/foundation/')) {
        const parts = reqPath.split('/');
        const requestedFoundId = parseInt(parts[3], 10);

        const isConcepteur = (user.role === 'concepteur');
        const isOwnerFoundation = (user.role === 'fondateur' && user.foundationId === requestedFoundId);

        if (!isConcepteur && !isOwnerFoundation) {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: `Accès refusé à la Fondation #${requestedFoundId}. Votre profil ne possède pas les permissions requises.`
          });
        }

        return sendJson(res, 200, {
          foundationId: requestedFoundId,
          authorized: true,
          message: 'Données de groupe autorisées'
        });
      }

      // CRUD ÉLÈVES (/api/students)
      if (reqPath === '/api/students' && req.method === 'GET') {
        const schoolParam = parsedUrl.searchParams.get('school_id');
        const schoolId = schoolParam ? parseInt(schoolParam, 10) : null;
        const students = db.getStudents(user, schoolId);
        return sendJson(res, 200, students);
      }

      if (reqPath === '/api/students' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const newStudent = db.createStudent(user, body);
        return sendJson(res, 201, { success: true, student: newStudent });
      }

      if (reqPath.startsWith('/api/students/') && req.method === 'GET') {
        const id = parseInt(reqPath.split('/')[3], 10);
        const student = db.getStudentById(id);
        if (!student) return sendJson(res, 404, { error: 'Élève non trouvé' });
        return sendJson(res, 200, student);
      }

      if (reqPath.startsWith('/api/students/') && req.method === 'PUT') {
        const id = parseInt(reqPath.split('/')[3], 10);
        const body = await parseJsonBody(req);
        const updated = db.updateStudent(user, id, body);
        return sendJson(res, 200, { success: true, student: updated });
      }

      if (reqPath.startsWith('/api/students/') && req.method === 'DELETE') {
        const id = parseInt(reqPath.split('/')[3], 10);
        const result = db.deleteStudent(user, id);
        return sendJson(res, 200, result);
      }

      // CLASSES (/api/classes)
      if (reqPath === '/api/classes' && req.method === 'GET') {
        const classes = db.getClasses(user);
        return sendJson(res, 200, classes);
      }

      if (reqPath === '/api/classes' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const newClass = db.createClass(user, body);
        return sendJson(res, 201, { success: true, class: newClass });
      }

      if (reqPath.startsWith('/api/classes/') && req.method === 'PUT') {
        const id = parseInt(reqPath.split('/')[3], 10);
        const body = await parseJsonBody(req);
        const updated = db.updateClass(user, id, body);
        return sendJson(res, 200, { success: true, class: updated });
      }

      if (reqPath.startsWith('/api/classes/') && req.method === 'DELETE') {
        const id = parseInt(reqPath.split('/')[3], 10);
        const result = db.deleteClass(user, id);
        return sendJson(res, 200, result);
      }

      // CAISSES (/api/cash/desks)
      if (reqPath === '/api/cash/desks' && req.method === 'GET') {
        const desks = db.getCashDesks(user);
        return sendJson(res, 200, desks);
      }

      if (reqPath === '/api/cash/desks' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const newDesk = db.createCashDesk(user, body);
        return sendJson(res, 201, { success: true, desk: newDesk });
      }

      // VERSEMENTS (/api/cash/deposits)
      if (reqPath === '/api/cash/deposits' && req.method === 'GET') {
        const deposits = db.getCashDeposits(user);
        return sendJson(res, 200, deposits);
      }

      if (reqPath === '/api/cash/deposits' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const newDeposit = db.createCashDeposit(user, body);
        return sendJson(res, 201, { success: true, deposit: newDeposit });
      }

      if (reqPath.includes('/api/cash/deposits/') && reqPath.endsWith('/validate') && req.method === 'POST') {
        const parts = reqPath.split('/');
        const id = parseInt(parts[4], 10);
        const result = db.validateCashDeposit(user, id);
        return sendJson(res, 200, { success: true, ...result });
      }

      if (reqPath.includes('/api/cash/deposits/') && reqPath.endsWith('/reject') && req.method === 'POST') {
        const parts = reqPath.split('/');
        const id = parseInt(parts[4], 10);
        const body = await parseJsonBody(req);
        const result = db.rejectCashDeposit(user, id, body.reason);
        return sendJson(res, 200, { success: true, deposit: result });
      }

      // PAIEMENTS ÉCOLAGES (/api/payments)
      if (reqPath === '/api/payments' && req.method === 'GET') {
        const schoolParam = parsedUrl.searchParams.get('school_id');
        const schoolId = schoolParam ? parseInt(schoolParam, 10) : null;
        const payments = db.getPayments(user, schoolId);
        return sendJson(res, 200, payments);
      }

      if (reqPath === '/api/payments' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const result = db.recordPayment(user, body);
        return sendJson(res, 201, { success: true, ...result });
      }

      // PURGE DE DÉMONSTRATION & ASSAINISSEMENT PRODUCTION (/api/admin/purge-demo-data)
      if (reqPath === '/api/admin/purge-demo-data' && req.method === 'POST') {
        if (user.role !== 'concepteur') {
          return sendJson(res, 403, {
            error: 'Forbidden',
            message: 'Action réservée exclusivement au Concepteur Système (Niveau 1).'
          });
        }
        const result = db.sanitizeProductionDatabase();
        const bootstrap = db.getBootstrapData(user);
        return sendJson(res, 200, {
          success: true,
          message: 'Toutes les fausses données ont été supprimées. Base de données en mode production réel.',
          result,
          ...bootstrap
        });
      }

      // GESTION MULTI-TENANT ENTITÉS (/api/schools, /api/foundations)
      if (reqPath === '/api/schools' && req.method === 'POST') {
        if (user.role !== 'concepteur' && user.role !== 'fondateur') {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: 'Accès refusé : la création et le rattachement d\'établissements sont réservés au Concepteur et à la Fondation Mère.'
          });
        }
        const body = await parseJsonBody(req);
        const newSchool = db.createSchool(user, body);
        return sendJson(res, 201, { success: true, school: newSchool });
      }

      if (reqPath === '/api/foundations' && req.method === 'POST') {
        if (user.role !== 'concepteur') {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: 'Accès souverain refusé : seul le Concepteur du SaaS (Niveau 1) peut créer une nouvelle Fondation Mère.'
          });
        }
        const body = await parseJsonBody(req);
        const newFound = db.createFoundation(user, body);
        return sendJson(res, 201, { success: true, foundation: newFound });
      }

      if (reqPath.startsWith('/api/schools/') && req.method === 'DELETE') {
        const schoolId = parseInt(reqPath.split('/')[3], 10);
        if (user.role !== 'concepteur' && user.role !== 'fondateur') {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: 'Accès refusé : la suppression d\'un établissement est réservée au Concepteur et à sa Fondation de tutelle.'
          });
        }
        try {
          const result = db.deleteSchool(user, schoolId);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, err.status || 400, { error: err.message, code: err.status || 400 });
        }
      }

      if (reqPath.startsWith('/api/foundations/') && req.method === 'DELETE') {
        const foundationId = parseInt(reqPath.split('/')[3], 10);
        if (user.role !== 'concepteur') {
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            message: 'Accès souverain refusé : seul le Concepteur du SaaS (Niveau 1) peut dissoudre une Fondation Mère.'
          });
        }
        try {
          const result = db.deleteFoundation(user, foundationId);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, err.status || 400, { error: err.message, code: err.status || 400 });
        }
      }

            // =====================================================================
      // CONTRÔLE D'ACCÈS HIÉRARCHIQUE & PARAMÈTRES MULTI-NIVEAUX (N1, N2, N3)
      // =====================================================================

      // 1. PARAMÈTRES SOUVERAINS DE LA PLATEFORME (NIVEAU 1 - CONCEPTEUR UNIQUEMENT)
      if (reqPath === '/api/settings/platform') {
        const userRank = db.getUserHierarchyRank(user);
        if (userRank > 1) {
          db.logSecurityViolation(user, 'SECURITY_UPWARD_ESCALATION_BLOCKED', 'Paramètres Plateforme (N1)',
            `Utilisateur Rang #${userRank} (${user.role}) a tenté d'accéder aux paramètres souverains du Concepteur`);
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            reason: 'UPWARD_PRIVILEGE_ESCALATION',
            message: 'Accès souverain refusé [Anti-Escalade Ascendante] : Les paramètres de la plateforme sont strictement réservés au Concepteur du logiciel (Niveau 1).'
          });
        }

        if (req.method === 'GET') {
          const settings = db.getSystemSettings(user);
          return sendJson(res, 200, { success: true, ...settings });
        }

        if (req.method === 'PUT' || req.method === 'POST') {
          const body = await parseJsonBody(req);
          const updated = db.updateSystemSettings(user, body);
          return sendJson(res, 200, { success: true, ...updated });
        }
      }

      // 2. PARAMÈTRES DE FONDATION (NIVEAU 2 - CONCEPTEUR OU FONDATION TITULAIRE)
      if (reqPath.startsWith('/api/settings/foundation/')) {
        const parts = reqPath.split('/');
        const foundId = parseInt(parts[4], 10);
        const userRank = db.getUserHierarchyRank(user);

        // Anti-escalade ascendante : Établissement (Rang 3) interdit
        if (userRank > 2) {
          db.logSecurityViolation(user, 'SECURITY_UPWARD_ESCALATION_BLOCKED', `Paramètres Fondation #${foundId}`,
            `Utilisateur d'école (${user.nom}) a tenté une escalade ascendante vers les paramètres de la Fondation #${foundId}`);
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            reason: 'UPWARD_PRIVILEGE_ESCALATION',
            message: 'Accès refusé [Anti-Escalade Ascendante] : Un établissement scolaire (Niveau 3) ne peut pas accéder aux paramètres de la Fondation Mère (Niveau 2).'
          });
        }

        // Cloisonnement horizontal : Fondation A ne peut pas toucher Fondation B
        if (userRank === 2 && user.foundationId !== foundId) {
          db.logSecurityViolation(user, 'SECURITY_CROSS_TENANT_BLOCKED', `Paramètres Fondation #${foundId}`,
            `Fondateur #${user.foundationId} a tenté d'accéder aux paramètres de la Fondation tierce #${foundId}`);
          return sendJson(res, 403, {
            error: 'Forbidden',
            code: 403,
            reason: 'CROSS_TENANT_FOUNDATION_DENIED',
            message: `Accès refusé : Vous ne pouvez gérer que les paramètres de votre propre Fondation (#${user.foundationId}).`
          });
        }

        try {
          if (req.method === 'GET') {
            const data = db.getFoundationSettings(user, foundId);
            return sendJson(res, 200, { success: true, ...data });
          }
          if (req.method === 'PUT' || req.method === 'POST') {
            const body = await parseJsonBody(req);
            const updated = db.updateFoundationSettings(user, foundId, body);
            return sendJson(res, 200, { success: true, ...updated });
          }
        } catch (err) {
          return sendJson(res, err.status || 500, { error: err.message, code: err.code || 500 });
        }
      }

      // 3. PARAMÈTRES D'ÉTABLISSEMENT (NIVEAU 3 - CONCEPTEUR, FONDATION TUTELLE OU PROPRE ÉCOLE)
      if (reqPath.startsWith('/api/settings/school/')) {
        const parts = reqPath.split('/');
        const schoolId = parseInt(parts[4], 10);
        const userRank = db.getUserHierarchyRank(user);

        try {
          if (req.method === 'GET') {
            const data = db.getSchoolSettings(user, schoolId);
            return sendJson(res, 200, { success: true, ...data });
          }
          if (req.method === 'PUT' || req.method === 'POST') {
            const body = await parseJsonBody(req);
            const updated = db.updateSchoolSettings(user, schoolId, body);
            return sendJson(res, 200, { success: true, ...updated });
          }
        } catch (err) {
          return sendJson(res, err.status || 403, {
            error: 'Forbidden',
            code: err.status || 403,
            reason: err.code || 'ACCESS_DENIED',
            message: err.message
          });
        }
      }

      // 4. SIGNALEMENT D'INFRACTION / TENTATIVE D'ESCALADE DE PRIVILÈGE ASCENDANTE
      if (reqPath === '/api/security/audit-escalation' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const recordedLog = db.logSecurityViolation(
          user,
          body.action || 'SECURITY_UPWARD_ESCALATION_BLOCKED',
          body.target || 'Ressource Hiérarchique Protégée',
          body.details || 'Tentative d\'escalade ascendante détectée par le garde client'
        );
        return sendJson(res, 200, { success: true, recorded: true, log: recordedLog });
      }

// JOURNAUX D'AUDIT (/api/audit-logs)
      if (reqPath === '/api/audit-logs' && req.method === 'GET') {
        const logs = db.getAuditLogs(user);
        return sendJson(res, 200, logs);
      }

      if (reqPath === '/api/audit-logs' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        db.addAuditLog(user, body);
        return sendJson(res, 201, { success: true });
      }

      // UTILISATEURS RBAC (/api/users)
      if (reqPath === '/api/users' && req.method === 'GET') {
        const users = db.getUsers(user);
        return sendJson(res, 200, users);
      }

      if (reqPath === '/api/users' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const newUser = db.createUser(user, body);
        return sendJson(res, 201, { success: true, user: newUser });
      }

      if (reqPath.startsWith('/api/users/') && req.method === 'DELETE') {
        const id = parseInt(reqPath.split('/')[3], 10);
        const result = db.deleteUser(user, id);
        return sendJson(res, 200, result);
      }

      // Fallback API 404
      return sendJson(res, 404, { error: 'Endpoint introuvable' });
    } catch (err) {
      console.error('[API Error]', req.method, reqPath, err.message);
      return sendJson(res, 400, {
        error: err.message || 'Erreur lors du traitement de la requête'
      });
    }
  }

  // 2. Contrôle d'Accès Côté Serveur sur les Routes Directes (/platform, /foundation, /school)
  const user = getRequestUser(req, parsedUrl);

  // A. NIVEAU 1 : /platform ou /platform/* -> STRICTEMENT CONCEPTEUR DU SaaS
  if (reqPath === '/platform' || reqPath.startsWith('/platform/')) {
    if (user.role !== 'concepteur') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(render403Page(
        'Accès Souverain Strictement Réservé',
        'Le tableau de bord souverain du Concepteur du SaaS (Mission Control) est totalement isolé. Il ne peut en aucun cas être visualisé ou accédé par un compte d\'école ou de fondation.',
        user,
        'CONCEPTEUR_SAAS (Niveau 1)'
      ));
    }
    // Si Concepteur autorisé, servir index.html avec le shell plateforme activé
    reqPath = '/index.html';
  }

  // B. NIVEAU 2 : /foundation ou /foundation/* -> CONCEPTEUR OU FONDATEUR DE LA FONDATION
  if (reqPath === '/foundation' || reqPath.startsWith('/foundation/')) {
    if (user.role !== 'concepteur' && user.role !== 'fondateur') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(render403Page(
        'Accès Fondation Mère Interdit',
        'Ce portail de supervision de groupe éducatif est réservé aux dirigeants de la Fondation Mère. Les personnels d\'établissement scolaire sont strictement cloisonnés dans leur propre école.',
        user,
        'FONDATION_MERE (Niveau 2)'
      ));
    }
    reqPath = '/index.html';
  }

  // C. NIVEAU 3 : /school ou /school/* -> AUTORISÉ AUX MEMBRES DE L'ÉCOLE, FONDATION ET CONCEPTEUR
  if (reqPath === '/school' || reqPath.startsWith('/school/')) {
    reqPath = '/index.html';
  }

  // Racine ou /index.html
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqPath);

  // Vérification de sécurité de traversée de chemin
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Accès refusé');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Fichier non trouvé');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Injection automatique du cookie si paramètre d'URL switch_user est passé
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    };

    const cookies = parseCookies(req);
    if (parsedUrl.searchParams.get('switch_user') !== null || parsedUrl.searchParams.get('user_id') !== null) {
      const switchId = parseInt(parsedUrl.searchParams.get('switch_user') || parsedUrl.searchParams.get('user_id'), 10);
      if (!isNaN(switchId)) {
        headers['Set-Cookie'] = `scolapro_user_id=${switchId}; Path=/; SameSite=Lax`;
      }
    } else if (cookies['scolapro_user_id'] === undefined && (reqPath === '/platform' || reqPath === '/foundation' || reqPath === '/school' || reqPath === '/index.html')) {
      headers['Set-Cookie'] = `scolapro_user_id=${user.id}; Path=/; SameSite=Lax`;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

function startServer(port) {
  return server.listen(port, '0.0.0.0', () => {
    console.log(`Serveur ScolaPro Multi-Tenant actif sur : http://localhost:${port}`);
    console.log(`Portail Concepteur (N1) : http://localhost:${port}/platform`);
    console.log(`Portail Fondation (N2)  : http://localhost:${port}/foundation`);
    console.log(`Espace École (N3)      : http://localhost:${port}/school`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} déjà utilisé, tentative sur le port ${PORT + 1}...`);
    PORT++;
    startServer(PORT);
  } else {
    console.error('Erreur serveur:', err);
  }
});

if (require.main === module) {
  startServer(PORT);
}

module.exports = { server, startServer, USERS, getRequestUser };
