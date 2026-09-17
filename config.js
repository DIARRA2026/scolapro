/**
 * ScolaPro v2.5 — Configuration Frontend Client
 * Édité et Développé par : INNOVA GROUP
 *
 * Ce fichier expose les variables publiques non-sensibles de l'environnement
 * sous le namespace global window.__APP_CONFIG__.
 */

(function initClientConfig(window) {
  'use strict';

  window.__APP_CONFIG__ = {
    // Identité Applicative
    APP_NAME: 'ScolaPro',
    APP_BRAND: 'INNOVA GROUP',
    APP_VERSION: '2.5.0',
    APP_ENV: 'production',
    APP_DEBUG: false,
    
    // Localisation & Fuseau Horaire
    DEFAULT_LOCALE: 'fr-FR',
    TIMEZONE: 'Africa/Abidjan',
    CURRENCY: 'XOF', // Franc CFA (UEMOA)
    CURRENCY_SYMBOL: 'FCFA',

    // Paramètres d'API & Backend
    API_BASE_URL: window.location.origin,
    API_TIMEOUT_MS: 15000,

    // AVERTISSEMENT DE SÉCURITÉ : Aucune clé sensible ne doit être présente dans ce fichier.
    // Les clés anon Supabase éventuellement exposées dans l'historique git doivent être révoquées
    // et régénérées sur la console d'administration de l'infrastructure.
    // L'intégration Supabase éventuelle doit être hydratée de manière dynamique via /api/config.
    SUPABASE: {
      URL: '',
      ANON_KEY: ''
    },

    // Multi-Tenant & Établissement par Défaut
    MULTI_TENANT: {
      ENABLED: true,
      DEFAULT_TYPE: 'SCHOOL',
      DEFAULT_SCHOOL_ID: null,
      DEFAULT_SCHOOL_CODE: null,
      DEFAULT_FOUNDATION_ID: null,
      DEFAULT_FOUNDATION_CODE: null
    },

    // Fonctionnalités & Feature Flags
    FEATURES: {
      PAYMENT_REMINDERS: true,
      AUTO_TIMETABLE: true,
      SMS_NOTIFICATIONS: true,
      RBAC_AUDIT_LOGS: true,
      SCHOOL_GENERATOR: true
    },

    // Piste d'Audit & Sécurité RG-11
    SECURITY: {
      AUDIT_ENABLED: true,
      SESSION_TIMEOUT_MINUTES: 120,
      MAX_LOGIN_ATTEMPTS: 5
    }
  };

  // Gel de la configuration client pour empêcher toute altération malveillante
  if (Object.freeze) {
    Object.freeze(window.__APP_CONFIG__);
    Object.freeze(window.__APP_CONFIG__.MULTI_TENANT);
    Object.freeze(window.__APP_CONFIG__.FEATURES);
    Object.freeze(window.__APP_CONFIG__.SECURITY);
  }

})(typeof window !== 'undefined' ? window : this);
