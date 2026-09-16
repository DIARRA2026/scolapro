# ScolaPro — Plateforme SaaS Multi-Tenant de Gestion Scolaire & Financière

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D22.5.0-brightgreen.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Zero Dependency](https://img.shields.io/badge/Dependencies-0%20External-blue.svg?style=flat-square)](package.json)
[![Architecture](https://img.shields.io/badge/Architecture-Multi--Tenant%203--Tiers-purple.svg?style=flat-square)](#-architecture-hiérarchique-à-3-niveaux)
[![Database](https://img.shields.io/badge/Database-SQLite%20WAL%20%7C%20Postgres%20Ready-orange.svg?style=flat-square)](schema.sql)
[![CI Pipeline](https://img.shields.io/badge/CI-GitHub%20Actions-blueviolet.svg?style=flat-square)](.github/workflows/ci.yml)
[![Region](https://img.shields.io/badge/Region-UEMOA%20%2F%20MENA-darkgreen.svg?style=flat-square)](#-spécificités-régionales--réglementaires)

**ScolaPro** est une solution logicielle SaaS de référence conçue pour la gouvernance administrative, pédagogique et la gestion financière rigoureuse des établissements scolaires, collèges, lycées et groupes éducatifs en Afrique de l'Ouest (Zone UEMOA).

---

## 🏛️ Architecture Hiérarchique à 3 Niveaux

ScolaPro intègre un modèle de contrôle d'accès hermétique empêchant toute escalade de privilèges ascendante :

```mermaid
graph TD
    subgraph N1 ["NIVEAU 1 — SOUVERAIN (Éditeur du SaaS)"]
        A["Dr. Patrick KOFFI<br/>Concepteur & Super Admin<br/>/platform"]
    end

    subgraph N2 ["NIVEAU 2 — FONDATION MÈRE (Groupe Scolaire)"]
        B["Dr. Patrice KOUAMÉ<br/>Président Fondation FEA<br/>/foundation"]
    end

    subgraph N3 ["NIVEAU 3 — ÉTABLISSEMENT SCOLAIRE (Tenant Autonome)"]
        C["M. Mathieu DIARRA<br/>Proviseur Lycée Sainte-Marie<br/>/school"]
        D["Collège Sainte-Anne<br/>(Établissement rattaché)"]
        E["École Les Lauriers<br/>(Établissement rattaché)"]
    end

    A -->|Supervision globale & Provisioning| B
    A -->|Supervision globale & Provisioning| C
    B -->|Agrégation financière & RH de ses écoles| C
    B -->|Agrégation financière & RH de ses écoles| D
    B -->|Agrégation financière & RH de ses écoles| E

    style A fill:#4c0519,stroke:#e11d48,stroke-width:2px,color:#fff
    style B fill:#172554,stroke:#2563eb,stroke-width:2px,color:#fff
    style C fill:#064e3b,stroke:#059669,stroke-width:2px,color:#fff
    style D fill:#0f172a,stroke:#475569,stroke-width:1px,color:#cbd5e1
    style E fill:#0f172a,stroke:#475569,stroke-width:1px,color:#cbd5e1
```

| Compartiment | Rôle Principal | Périmètre & Isolation | URL d'Accès |
| :--- | :--- | :--- | :--- |
| **Niveau 1 — Concepteur** | Super Admin Plateforme | Accès souverain global (Toutes fondations, toutes écoles, supervision système, maintenance). | [`/platform`](http://localhost:3005/platform) |
| **Niveau 2 — Fondation** | Président de Groupe Éducatif | Vue consolidée sur ses propres établissements. Interdiction stricte de toucher aux configurations souveraines. | [`/foundation`](http://localhost:3005/foundation) |
| **Niveau 3 — École** | Proviseur & Équipes École | Confinement strict aux élèves, classes, caisses et enseignants de l'établissement. | [`/school`](http://localhost:3005/school) |

---

## ⚡ Points Forts & Choix Technologiques

* **Zéro Dépendance Externe en Exécution :** Propulsé exclusivement par les modules natifs de Node.js (`http`, `fs`, `path`, `crypto`) et le moteur SQLite officiel haute performance `node:sqlite` (`DatabaseSync` en mode WAL avec `busy_timeout`).
* **Intégrité Financière ACID (SYSCOHADA) :** Transactions atomiques garanties (`BEGIN TRANSACTION ... COMMIT`) lors des transferts inter-caisses et des encaissements d'écolages.
* **Sécurité & En-têtes HTTP de Production :** Protection native contre le clickjacking (`X-Frame-Options: SAMEORIGIN`), le sniffing MIME (`X-Content-Type-Options: nosniff`), le cross-site scripting (`X-XSS-Protection`) et politique de référencement stricte.
* **Double Cible de Persistance :** Déploiement ultra-léger instantané sur SQLite en local / Edge, et schéma SQL d'entreprise prêt pour PostgreSQL 14+ (`schema.sql`).
* **Healthcheck Intégré :** Endpoint `/health` et `/api/health` pour la supervision continue par les reverse-proxies (Nginx, AWS ALB, Cloudflare).

---

## 🚀 Démarrage Rapide

### 1. Prérequis
* **Node.js >= 22.5.0** (Requis pour l'API native `node:sqlite`).

### 2. Installation & Lancement
```bash
# 1. Cloner le référentiel
git clone https://github.com/votre-organisation/scolapro.git
cd scolapro

# 2. Configurer les variables d'environnement
cp .env.example .env

# 3. Démarrer le serveur (Port 3005 par défaut)
npm start

# Ou en mode développement avec rechargement à chaud :
npm run dev
```

### 3. Accès aux Portails
* **Portail Concepteur (Niveau 1) :** [http://localhost:3005/platform](http://localhost:3005/platform)
* **Portail Fondation (Niveau 2) :** [http://localhost:3005/foundation](http://localhost:3005/foundation)
* **Espace École (Niveau 3) :** [http://localhost:3005/school](http://localhost:3005/school)
* **Healthcheck Serveur & DB :** [http://localhost:3005/health](http://localhost:3005/health)

---

## 🧪 Tests Automatisés & Vérifications

ScolaPro utilise le banc d'essai natif de Node.js (`node:test` & `node:assert`), sans alourdir le projet d'outils tiers comme Jest ou Mocha :

```bash
# Exécuter la suite de tests automatisés
npm test

# Vérifier la syntaxe de tous les fichiers JavaScript
npm run lint

# Purger et réinitialiser les données de production
npm run db:sanitize
```

### Couverture des Tests Intégrés :
- `tests/health.test.js` : Vérification du statut UP, des en-têtes HTTP de sécurité et de la connectivité DB.
- `tests/rbac_isolation.test.js` : Vérification de l'étanchéité 3-tiers et du blocage HTTP 403 Forbidden sur tentative d'escalade.
- `tests/financial_acid.test.js` : Vérification de l'atomicité financière des paiements, des versements inter-caisses et du verrou anti-suppression d'élèves cotisants.

---

## 🌍 Spécificités Régionales & Réglementaires

* **Devise Intégrale :** Franc CFA (XOF / UEMOA) traité en montants entiers stricts.
* **Format Matricule MENA :** Normalisation conforme aux directives des Ministères de l'Éducation Nationale d'Afrique de l'Ouest (ex: `23019284K`).
* **Comptabilité Inter-Caisses :** Double écriture comptable conforme SYSCOHADA (Bordereaux de versement `DEP-YYYY-XXXX`, Quittances sécurisées `QUIT-YYYY-XXXX`).
* **Protection des Données Personnelles :** Conformité aux principes de l'APDP (Côte d'Ivoire - Loi n° 2013-450) pour le traitement des données des élèves mineurs.

---

## 📁 Structure du Projet

```text
scolapro/
├── .github/
│   └── workflows/
│       └── ci.yml               # Pipeline d'intégration continue GitHub Actions
├── tests/
│   ├── health.test.js           # Tests de l'endpoint de santé et headers HTTP
│   ├── rbac_isolation.test.js   # Tests d'étanchéité multi-tenant & 403 Forbidden
│   └── financial_acid.test.js   # Tests transactions atomiques & règles de caisse
├── .editorconfig                # Standardisation des indentations et encodages
├── .env.example                 # Modèle des variables de configuration
├── .gitignore                   # Exclusions strictes des bases .db et secrets .env
├── config.js                    # Configuration publique immuable côté client
├── db.js                        # Moteur SQLite persistant (node:sqlite WAL)
├── index.html                   # Application Frontend & Shells multi-compartiments
├── inscription.html             # Portail web d'enrôlement des nouveaux élèves
├── package.json                 # Définition du projet et scripts Node.js
├── PRODUCTION_GUIDE.md          # Guide officiel de déploiement et référentiel
├── schema.sql                   # Schéma relationnel d'entreprise (PostgreSQL 14+)
└── server.js                    # Noyau serveur HTTP natif, sécurité et API REST
```

---

## 🔐 Sécurité & Bonnes Pratiques

* Les bases de données SQLite locales (`*.db`, `*.db-wal`, `*.db-shm`) et les fichiers de secrets (`.env`, `.env.production`) sont protégés par le `.gitignore` et **ne doivent jamais être publiés dans un commit public**.
* En environnement de démonstration locale, le serveur permet la simulation des rôles pour faciliter les revues UX. En production externe, activez impérativement la signature cryptographique des sessions JWT (voir `PRODUCTION_GUIDE.md`).

---

## 🏢 Éditeur & Propriété Intellectuelle

Développé et édité par **INNOVA GROUP** — Abidjan, Côte d'Ivoire.  
Tous droits réservés © 2026.
