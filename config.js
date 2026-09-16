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

    // Intégration Supabase (Injectée via serveur ou configuration d'infrastructure)
    SUPABASE: {
      URL: 'https://vfwqvtokfwevjharycnm.supabase.co',
      ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmd3F2dG9rZndldmpoYXJ5Y25tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MDg3NDQsImV4cCI6MjEwNTA4NDc0NH0.ozzvuJC52aIT8LETpyF4mENaOm2DhONA9O6kfiE3Isc'
    },

    // Multi-Tenant & Établissement par Défaut
    MULTI_TENANT: {
      ENABLED: true,
      DEFAULT_TYPE: 'SCHOOL',
      DEFAULT_SCHOOL_ID: 1,
      DEFAULT_SCHOOL_CODE: 'LYC-SAINTE-MARIE',
      DEFAULT_FOUNDATION_ID: 1,
      DEFAULT_FOUNDATION_CODE: 'FEA'
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
