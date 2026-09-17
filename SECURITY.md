# Politique & Rapport de Sécurité — ScolaPro v2.5.0

**Dernière révision :** Septembre 2026  
**Auditeur / Rôle :** Développeur Senior Sécurité Applicative & Systèmes Financiers  
**Conformité visée :** OWASP Top 10, SYSCOHADA, APDP (Loi n° 2013-450, protection des données des élèves mineurs), ISO 27001  

---

## 1. Analyse Détaillée des 6 Vulnérabilités Critiques & Correctifs Appliqués

Avant les travaux de durcissement, ScolaPro présentait 6 failles critiques majeures empêchant toute commercialisation à des établissements scolaires réels manipulant des fonds et des données d'élèves mineurs. Chaque vulnérabilité a été reproduite, documentée, corrigée à la racine et couverte par des tests automatisés de non-régression.

---

### Faille 1 — Banalisation de l'authentification et contournement complet

* **Classification :** CWE-287 (Improper Authentication), CWE-306 (Missing Authentication for Critical Function).
* **Impact :** Critique. N'importe quel utilisateur anonyme ou non autorisé pouvait usurper l'identité du Concepteur Souverain (Niveau 1), créateur de la plateforme, ou de n'importe quel proviseur en injectant simplement l'en-tête HTTP `x-scolapro-user-id: 0` ou le paramètre d'URL `?user_id=0`. Côté client, la fonction JavaScript `switchUserRole(role)` permettait de basculer arbitrairement les droits d'affichage et d'action sans aucune validation serveur.
* **Mécanisme de reproduction :**
  ```http
  GET /api/bootstrap HTTP/1.1
  Host: localhost:3005
  x-scolapro-user-id: 0
  ```
  Le serveur retournait l'intégralité des données confidentielles de toutes les écoles et fondations sans exiger le moindre mot de passe ni session active.
* **Remédiation appliquée :**
  1. **Sessions cryptographiques d'État :** Suppression totale de la confiance accordée aux en-têtes `x-scolapro-user-id` et aux paramètres `?user_id`.
  2. **Authentification par Cookie Sécurisé :** Création de sessions chiffrées en base SQLite (`sessions` table avec jeton de 256 bits généré par `crypto.randomBytes(32)`), transmises exclusivement par cookie `scolapro_session` avec attributs `HttpOnly`, `SameSite=Strict`, `Path=/`, et `Secure` en production.
  3. **Hachage Scrypt :** Stockage des mots de passe avec l'algorithme cryptographique `scrypt` ($N=32768, r=8, p=1, \text{longueur}=64$ octets) avec sel de 128 bits, résistant aux attaques par GPU et tables arc-en-ciel.
  4. **Contrôle d'impersonation strict :** Le point d'accès `/api/auth/switch` est désormais **strictement réservé** aux utilisateurs de rang Concepteur Souverain (`concepteur`), avec journalisation d'audit systématique et rejet HTTP 403 pour tout autre rôle.
  5. **Page `/login.html` dédiée :** Page de connexion autonome sans dépendance externe, avec politique de verrouillage de compte (5 échecs consécutifs = blocage temporaire) et forçage de changement de mot de passe temporaire.

---

### Faille 2 — Élévation de privilèges verticale & horizontale (RBAC)

* **Classification :** CWE-269 (Improper Privilege Management), CWE-250 (Execution with Unnecessary Privileges).
* **Impact :** Critique. Un administrateur d'école (Niveau 3) ou un enseignant pouvait envoyer une requête POST vers `/api/users` pour créer un compte avec le rôle `concepteur` ou `fondateur`, ou pour s'attribuer la permission globale `'*'` (wildcard), prenant ainsi le contrôle total du SaaS.
* **Mécanisme de reproduction :**
  ```http
  POST /api/users HTTP/1.1
  Host: localhost:3005
  Content-Type: application/json
  Cookie: scolapro_session=<jeton_admin_ecole>

  {"name":"Attaquant","email":"hacker@test.local","role":"concepteur","permissions":["*"],"school_id":1}
  ```
  L'utilisateur `concepteur` était créé avec succès en base.
* **Remédiation appliquée :**
  1. **Noyau RBAC formel (`lib/rbac.js`) :** Définition stricte des 6 rôles (`concepteur`, `fondateur`, `admin_ecole`, `comptable`, `secretaire`, `consultation`) hiérarchisés par rang (Rang 1: Concepteur > Rang 2: Fondateur > Rang 3: Admin École > Rang 4: Opérationnels).
  2. **Interdiction d'auto-promotion & d'escalade :** La règle `assertCanAssignRole` interdit formellement à un utilisateur de créer ou modifier un utilisateur de rang supérieur ou égal au sien.
  3. **Règles d'assignation des rôles :**
     - Le rôle `concepteur` ne peut être attribué que par un `concepteur`.
     - Le rôle `fondateur` ne peut être attribué que par un `concepteur`.
     - L'administrateur d'école ne peut créer que des rôles opérationnels (`admin_ecole`, `comptable`, `secretaire`, `consultation`) au sein de son propre établissement.
  4. **Sanctuarisation de la permission universelle `'*'` :** Seul le rôle `concepteur` peut détenir la permission `'*'`. Toute tentative d'assigner `'*'` par un autre rôle lève une exception `AccessError(403, 'RBAC_WILDCARD_FORBIDDEN')`.
  5. **Séparation des fonctions :** Les caissiers et secrétaires ne peuvent ni administrer les comptes, ni supprimer des données sensibles, ni valider des dépôts de caisse.

---

### Faille 3 — Corruption financière inter-établissements (SYSCOHADA)

* **Classification :** CWE-662 (Improper Synchronization), CWE-488 (Data Exposure to the Wrong Session / School).
* **Impact :** Critique. Lors de la validation d'un versement inter-caisse pour l'École 2 (Collège Sainte-Anne) ou l'École 3, le code d'origine créditait systématiquement la caisse principale de l'École 1 (`PRINCIPALE`), car l'identifiant de caisse était codé en dur sans filtrage par `school_id`. L'argent d'un établissement apparaissait alors dans la comptabilité d'un autre, violant les règles comptables SYSCOHADA et le droit commercial UEMOA.
* **Mécanisme de reproduction :**
  Appel à `/api/cash/deposit` pour un versement de la caisse secondaire de l'École 2 : le solde de la caisse de l'École 1 augmentait, tandis que le solde de l'École 2 restait inchangé.
* **Remédiation appliquée :**
  1. **Isolation stricte des caisses par établissement :** Chaque école dispose de ses propres caisses rattachées par clé étrangère `school_id`. Si une école ne possède pas de caisse principale, le moteur crée automatiquement sa caisse `S{school_id}_PRINCIPALE`.
  2. **Invariant Financier Garanti :**
     $$\forall \text{ Établissement}, \quad \sum \text{soldes des caisses} = \sum \text{encaissements enregistrés}$$
  3. **Transactions ACID Atomiques (`node:sqlite`) :** Débit de la caisse source et crédit de la caisse destinataire exécutés au sein d'une même transaction SQLite (`BEGIN IMMEDIATE` / `COMMIT`), avec vérification préalable que le solde de la caisse source est suffisant ($\text{solde} \ge \text{montant}$).
  4. **Séparation des tâches financières :** L'opérateur qui a initié un versement ne peut en aucun cas valider lui-même ce versement (`CASH_DEPOSIT_SAME_USER`). La validation requiert un agent différent disposant des habilitations requises.
  5. **Contrôles anti-fraude :**
     - Rejet des montants nuls, négatifs, décimaux ou dépassant le plafond de sécurité (50 000 000 XOF).
     - Plafonnement des paiements d'élèves : interdiction de percevoir un montant supérieur au reste à payer de la scolarité (`PAYMENT_EXCEEDS_REMAINING_FEE`).
     - Interdiction absolue de supprimer un élève ayant déjà au moins un paiement enregistré en base (`STUDENT_HAS_PAYMENTS`).

---

### Faille 4 — Divulgation de données et de code source (Fuite Statique)

* **Classification :** CWE-200 (Exposure of Sensitive Information), CWE-22 (Path Traversal).
* **Impact :** Critique. Le serveur HTTP statique servait n'importe quel fichier présent à la racine du projet sans authentification, permettant le téléchargement direct de la base SQLite (`scolapro.db`), des fichiers de configuration (`.env`, `config.js`), du code source backend (`db.js`, `server.js`) et des répertoires internes (`.git/`).
* **Mécanisme de reproduction :**
  ```http
  GET /scolapro.db HTTP/1.1
  Host: localhost:3005
  ```
  Le serveur renvoyait le binaire SQLite complet contenant les données d'élèves et les tables financières.
* **Remédiation appliquée :**
  1. **Liste blanche stricte des ressources statiques (`lib/http-security.js`) :** Seuls les fichiers explicitement autorisés (`/`, `/index.html`, `/login.html`, `/inscription.html`, `/config.js`, `/favicon.ico`, `/assets/*`) peuvent être servis par le moteur de fichiers statiques.
  2. **Interdiction formelle des extensions sensibles :** Toute requête ciblant `.db`, `.js` (hormis les scripts clients autorisés), `.env`, `.json`, `.sql`, `.md`, `.git` est rejetée (redirection vers `/login.html` pour un visiteur anonyme, ou HTTP 404/403 pour un utilisateur authentifié).
  3. **Protection anti-traversée (`resolveStaticPath`) :** Normalisation par `path.resolve` et vérification que le chemin résolu demeure strictement à l'intérieur de la racine publique autorisée.
  4. **En-têtes HTTP de protection :** Envoi systématique de `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, et `Content-Security-Policy`.

---

### Faille 5 — Failles IDOR & Violation de l'Isolation Multi-Tenant

* **Classification :** CWE-639 (Authorization Bypass Through User-Controlled Key / IDOR).
* **Impact :** Critique. En modifiant l'identifiant `school_id` ou `student_id` dans les requêtes d'API, un utilisateur de l'École 1 pouvait lire, modifier ou supprimer les dossiers scolaires, les informations médicales et les données de caisse de l'École 2 ou de l'École 3.
* **Mécanisme de reproduction :**
  ```http
  GET /api/students?school_id=2 HTTP/1.1
  Host: localhost:3005
  Cookie: scolapro_session=<jeton_admin_ecole_1>
  ```
  L'administrateur de l'École 1 obtenait la liste intégrale des élèves de l'École 2.
* **Remédiation appliquée :**
  1. **Contrôle d'accès aux données (`assertSchoolAccess` / `assertFoundationAccess`) :**
     - Pour un utilisateur d'école (`admin_ecole`, `comptable`, etc.), le paramètre `school_id` de la requête est ignoré ou validé contre `user.school_id`. S'il y a divergence, la requête est rejetée avec une erreur `AccessError(403, 'TENANT_SCHOOL_MISMATCH')`.
     - Pour un utilisateur de fondation (`fondateur`), l'accès est strictement circonscrit aux écoles appartenant à sa fondation (`foundation_schools`). Toute tentative d'accéder à une école hors fondation est rejetée (`TENANT_FOUNDATION_MISMATCH`).
     - Seul le `concepteur` (Rang 1) dispose du droit de consulter les données transversales de l'ensemble des établissements.
  2. **Filtrage SQL systématique au niveau DAO (`db.js`) :** Toutes les requêtes de lecture (`getStudents`, `getPayments`, `getCashDesks`, `getCashDeposits`) injectent obligatoirement le filtre d'établissement validé.
  3. **Vérification d'existence et de périmètre lors des écritures :** Toute opération de création, mise à jour ou suppression vérifie l'existence préalable de la ressource et son appartenance exclusive à l'établissement de l'opérateur.

---

### Faille 6 — Injection XSS et Porte Dérobée Frontend

* **Classification :** CWE-79 (Cross-Site Scripting), CWE-912 (Hidden Functionality / Backdoor).
* **Impact :** Élevé.
  - La présence dans `index.html` de `window._bypassSecurityForTest = true;` constituait une porte dérobée désactivant les vérifications de sécurité côté client.
  - Les fonctions de rendu UI (notamment `render403Page` et plus de 600 gabarits HTML littéraux) injectaient directement les valeurs sans échappement HTML, permettant l'exécution de code JavaScript arbitraire (Stored & Reflected XSS) via le nom d'un élève ou le libellé d'une dépense.
* **Mécanisme de reproduction :**
  Création d'un élève avec le nom `<img src=x onerror=alert(document.cookie)>` : le script s'exécutait lors de l'affichage du tableau des élèves ou de la page d'interdiction 403.
* **Remédiation appliquée :**
  1. **Éradication complète de la porte dérobée :** Suppression totale de `_bypassSecurityForTest` et de toute condition de contournement dans l'ensemble du projet.
  2. **Assainissement & Échappement contextuel (`esc()` et `escJs()`) :**
     - Injection de fonctions natives d'échappement dans `index.html` et `lib/http-security.js`.
     - Remplacement de 644 interpolations de gabarits vulnérables par leur version assainie (`${esc(item.champ)}`).
     - Échappement formel des paramètres de `render403Page(title, message)`.
  3. **Protection contre la pollution de prototype & corps volumineux :**
     - Analyseur de corps HTTP (`readJsonBody`) plafonné à 512 KiB (rejet HTTP 413) avec drainage propre des flux réseau.
     - Suppression automatique des clés malveillantes `__proto__`, `constructor` et `prototype`.
  4. **Politique CSP stricte :** Déclaration de `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`.

---

## 2. Dette Technique & Concession CSP

### Situation Actuelle (Concession `unsafe-inline`)

Pour préserver l'intégrité fonctionnelle des ~16 000 lignes de JavaScript inline monolithique de `index.html` sans régression applicative, l'en-tête `Content-Security-Policy` inclut actuellement la directive :
```http
script-src 'self' 'unsafe-inline';
```

### Risque Résiduel

Bien que toutes les interpolations de données dynamiques soient désormais protégées par la fonction d'échappement `esc()` et que le serveur applique une validation stricte des entrées/sorties, `unsafe-inline` permet théoriquement l'exécution de scripts injectés si une interpolation non échappée venait à être introduite à l'avenir.

### Feuille de Route de Remédiation (Roadmap v3.0)

1. **Phase 1 — Extraction des scripts :** Extraire les scripts inline de `index.html` vers des modules JavaScript externes distribués dans un répertoire dédié (ex. `/public/js/app.js`, `/public/js/financial.js`, `/public/js/rbac.js`).
2. **Phase 2 — Utilisation de Nonces Cryptographiques :**
   - Générer un jeton cryptographique à usage unique (`nonce`) par requête HTTP dans `server.js` (`crypto.randomBytes(16).toString('base64')`).
   - Injecter ce jeton dans l'en-tête CSP : `script-src 'self' 'nonce-${nonce}'`.
3. **Phase 3 — Suppression définitive de `'unsafe-inline'` :** Élimination totale de la clause dans la politique CSP de production.

---

## 3. Checklist Impérative Avant Mise en Service dans un Établissement

Avant toute signature de contrat ou déploiement commercial auprès d'une école ou d'une fondation, l'équipe technique doit impérativement exécuter les étapes suivantes :

- [ ] **1. Révocation des identifiants Supabase historiques :**
  Accéder à la console d'administration Supabase et régénérer immédiatement les clés d'API (Anon Key et Service Role Key) ainsi que le mot de passe de base de données afin d'invalider définitivement les jetons historiques autrefois exposés.
- [ ] **2. Initialisation du compte Concepteur Souverain :**
  Ne jamais démarrer avec des mots de passe par défaut. Définir un mot de passe fort (au moins 12 caractères, majuscules, minuscules, chiffres et caractères spéciaux) via la ligne de commande sécurisée :
  ```bash
  node scripts/set-password.js admin@scolapro.ci "VOTRE_MOT_DE_PASSE_TRES_FORT"
  ```
- [ ] **3. Configuration de l'environnement de production :**
  Créer le fichier `.env` sur le serveur de production avec les paramètres :
  ```ini
  NODE_ENV=production
  APP_ENV=production
  PORT=3005
  HOST=127.0.0.1
  COOKIE_SECURE=true
  ```
  *(Le paramètre `HOST=127.0.0.1` empêche l'exposition directe du port Node.js sur Internet, forçant le passage par le reverse proxy).*
- [ ] **4. Déploiement d'un Proxy Inverse SSL/TLS (Nginx ou Caddy) :**
  - Configurer un certificat TLS valide (Let's Encrypt / DigiCert).
  - Activer HTTP Strict Transport Security (`HSTS`) avec `max-age=31536000; includeSubDomains; preload`.
  - Configurer les en-têtes proxy (`X-Forwarded-For`, `X-Forwarded-Proto`).
- [ ] **5. Sauvegarde & Chiffrement de la Base de Données SQLite :**
  - Mettre en place une tâche planifiée de sauvegarde à chaud utilisant la commande native `.backup` de SQLite ou la réplication WAL.
  - Chiffrer les copies de sauvegarde au repos (GPG / AES-256).
- [ ] **6. Exécution des Tests Automatisés de Non-Régression :**
  Vérifier que les 61 tests de sécurité et d'intégrité financière passent à 100 % sur l'environnement cible avant toute ouverture :
  ```bash
  npm test
  ```
- [ ] **7. Formation & Sensibilisation des Utilisateurs :**
  Rappeler aux proviseurs et comptables que les comptes sont strictement individuels et que le partage d'identifiants est formellement prohibé par le règlement APDP.

---
*Document rédigé avec rigueur technique par le pôle Sécurité Applicative ScolaPro.*
