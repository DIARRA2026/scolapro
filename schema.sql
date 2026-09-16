-- =====================================================================
-- ScolaPro — Schéma PostgreSQL (Un produit d'INNOVA GROUP)
-- Cible : PostgreSQL 14+
-- Convention : bigint identity en PK, school_id partout (multi-tenant),
--              montants en entiers (unité indivisible de la devise),
--              horodatage en timestamptz.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;      -- e-mails insensibles à la casse
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- recherche floue sur les noms
CREATE EXTENSION IF NOT EXISTS btree_gist; -- requis par la contrainte EXCLUDE sur periods

-- ---------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------
CREATE TYPE sexe_enum            AS ENUM ('M', 'F');
CREATE TYPE period_type_enum     AS ENUM ('TRIMESTRE', 'SEMESTRE');
CREATE TYPE period_status_enum   AS ENUM ('PLANIFIEE', 'OUVERTE', 'CLOTUREE', 'PUBLIEE');
CREATE TYPE enrollment_status_enum AS ENUM ('ACTIF', 'TRANSFERE', 'ABANDON', 'EXCLU', 'DIPLOME');
CREATE TYPE grading_policy_enum  AS ENUM ('WEIGHTED_COMPO', 'SIMPLE_AVERAGE', 'CUSTOM_WEIGHTS');
CREATE TYPE decision_enum        AS ENUM ('ADMIS', 'REDOUBLE', 'EXCLU', 'EN_ATTENTE');
CREATE TYPE attendance_enum      AS ENUM ('PRESENT', 'ABSENT', 'RETARD', 'RENVOYE');
CREATE TYPE payment_method_enum  AS ENUM ('ESPECES', 'MOBILE_MONEY', 'VIREMENT', 'CHEQUE', 'AUTRE');

-- =====================================================================
-- 1. SOCLE : fondations, établissements, utilisateurs, rôles
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.0 ENTITÉS MÈRES : FONDATIONS & GROUPES SCOLAIRES
-- ---------------------------------------------------------------------
CREATE TABLE foundations (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(30)  NOT NULL UNIQUE,          -- slug entité mère, ex. 'fondation-fea'
    name            varchar(200) NOT NULL,
    sigle           varchar(50),
    description     text,
    country_code    char(2)      NOT NULL DEFAULT 'CI',
    city            varchar(100),
    address         text,
    phone           varchar(50),
    email           citext,
    logo_path       varchar(255),
    president_name  varchar(150),
    is_active       boolean      NOT NULL DEFAULT true,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
COMMENT ON TABLE foundations IS 'Entité mère chapeautant un groupe d''écoles affiliées.';
CREATE INDEX foundations_code_idx ON foundations (code);

-- ---------------------------------------------------------------------
-- 1.1 ÉTABLISSEMENTS SCOLAIRES (TENANTS ISOLÉS OU AFFILIÉS)
-- ---------------------------------------------------------------------
CREATE TABLE schools (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(30)  NOT NULL UNIQUE,          -- slug tenant, ex. 'lyc-sainte-marie'
    name            varchar(200) NOT NULL,
    short_name      varchar(50),
    foundation_id   bigint REFERENCES foundations(id) ON DELETE SET NULL, -- NULL = École autonome
    school_type     varchar(50)  NOT NULL DEFAULT 'MIXTE', -- 'MATERNELLE', 'PRIMAIRE', 'COLLEGE', 'LYCEE', 'GROUPE_COMPLET'
    country_code    char(2)      NOT NULL DEFAULT 'CI',
    city            varchar(100),
    address         text,
    phone           varchar(50),
    email           citext,
    logo_path       varchar(255),
    currency        char(3)      NOT NULL DEFAULT 'XOF',
    timezone        varchar(50)  NOT NULL DEFAULT 'Africa/Abidjan',
    is_active       boolean      NOT NULL DEFAULT true,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
COMMENT ON TABLE schools IS 'Tenant école isolé. Peut être autonome ou affilié à une fondation.';
CREATE INDEX schools_foundation_idx ON schools (foundation_id);

-- Paramétrage pédagogique et financier, un enregistrement par établissement.
CREATE TABLE school_settings (
    school_id           bigint PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    period_type         period_type_enum   NOT NULL DEFAULT 'TRIMESTRE',
    grading_policy      grading_policy_enum NOT NULL DEFAULT 'WEIGHTED_COMPO',
    grading_config      jsonb              NOT NULL DEFAULT '{}'::jsonb,
    -- ex. {"devoir_weight":1,"compo_weight":2,"decimals":2,"rounding":"HALF_UP"}
    default_bareme      numeric(5,2)       NOT NULL DEFAULT 20.00,
    pass_mark           numeric(5,2)       NOT NULL DEFAULT 10.00,
    promotion_threshold numeric(5,2)       NOT NULL DEFAULT 10.00,
    mentions            jsonb              NOT NULL DEFAULT
        '[{"min":18,"label":"Excellent"},{"min":16,"label":"Très Bien"},{"min":14,"label":"Bien"},
          {"min":12,"label":"Assez Bien"},{"min":10,"label":"Passable"},{"min":8,"label":"Insuffisant"},
          {"min":0,"label":"Très Insuffisant"}]'::jsonb,
    optional_subject_bonus boolean         NOT NULL DEFAULT false,  -- RG-05
    block_report_if_unpaid boolean         NOT NULL DEFAULT false,  -- US-09 CA5
    matricule_format    varchar(50)        NOT NULL DEFAULT '{YEAR}-{CLASS}-{SEQ:4}',
    report_template     varchar(50)        NOT NULL DEFAULT 'default',
    sms_enabled         boolean            NOT NULL DEFAULT true,
    updated_at          timestamptz        NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id       bigint REFERENCES schools(id) ON DELETE CASCADE, -- NULL = super_admin
    first_name      varchar(100) NOT NULL,
    last_name       varchar(100) NOT NULL,
    email           citext,
    phone           varchar(30),
    password_hash   varchar(255) NOT NULL,
    must_change_password boolean NOT NULL DEFAULT true,
    avatar_path     varchar(255),
    is_active       boolean      NOT NULL DEFAULT true,
    last_login_at   timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    CONSTRAINT users_contact_chk CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
-- Un e-mail / un téléphone est unique DANS un établissement (le même parent
-- peut exister dans deux écoles avec deux comptes distincts).
CREATE UNIQUE INDEX users_school_email_uq ON users (school_id, email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_school_phone_uq ON users (school_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE roles (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        varchar(50) NOT NULL UNIQUE,   -- 'admin_school', 'enseignant', ...
    label       varchar(100) NOT NULL,
    is_system   boolean NOT NULL DEFAULT true
);

CREATE TABLE permissions (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        varchar(80) NOT NULL UNIQUE,   -- 'grade.create', 'report.generate', ...
    label       varchar(150) NOT NULL,
    module      varchar(50)  NOT NULL
);

CREATE TABLE role_permission (
    role_id       bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id bigint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE role_user (
    user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id  bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- =====================================================================
-- 2. STRUCTURE ACADÉMIQUE
-- =====================================================================

CREATE TABLE academic_years (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id   bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    label       varchar(20) NOT NULL,          -- '2026-2027'
    starts_on   date NOT NULL,
    ends_on     date NOT NULL,
    is_active   boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ay_dates_chk CHECK (ends_on > starts_on),
    CONSTRAINT ay_school_label_uq UNIQUE (school_id, label)
);
-- D2 : une seule année active par établissement
CREATE UNIQUE INDEX academic_years_one_active_uq
    ON academic_years (school_id) WHERE is_active;

CREATE TABLE periods (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year_id  bigint NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    name              varchar(50) NOT NULL,    -- 'Trimestre 1'
    sequence          smallint NOT NULL,       -- 1, 2, 3
    starts_on         date NOT NULL,
    ends_on           date NOT NULL,
    weight            numeric(4,2) NOT NULL DEFAULT 1.00,  -- RG-08
    status            period_status_enum NOT NULL DEFAULT 'PLANIFIEE',
    closed_at         timestamptz,
    published_at      timestamptz,
    CONSTRAINT periods_dates_chk CHECK (ends_on > starts_on),
    CONSTRAINT periods_seq_uq UNIQUE (academic_year_id, sequence)
);
-- US-01 CA1 : pas de chevauchement de périodes dans une même année
ALTER TABLE periods ADD CONSTRAINT periods_no_overlap
    EXCLUDE USING gist (
        academic_year_id WITH =,
        daterange(starts_on, ends_on, '[]') WITH &&
    );

CREATE TABLE levels (                            -- niveaux : CP1, 6e, Tle D...
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id   bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    cycle       varchar(30) NOT NULL,            -- 'MATERNELLE','PRIMAIRE','COLLEGE','LYCEE'
    name        varchar(50) NOT NULL,            -- '6e', 'Terminale D'
    ordering    smallint NOT NULL DEFAULT 0,
    CONSTRAINT levels_uq UNIQUE (school_id, name)
);

CREATE TABLE classrooms (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year_id  bigint NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    level_id          bigint NOT NULL REFERENCES levels(id),
    name              varchar(50) NOT NULL,      -- '6e A'
    capacity          smallint NOT NULL DEFAULT 60,
    room              varchar(50),
    head_teacher_id   bigint REFERENCES users(id),  -- professeur principal
    educator_id       bigint REFERENCES users(id),  -- éducateur référent de la classe
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT classrooms_uq UNIQUE (academic_year_id, name)
);

CREATE TABLE subject_groups (                    -- Sciences, Littéraires, Éveil
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id   bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name        varchar(80) NOT NULL,
    ordering    smallint NOT NULL DEFAULT 0,
    CONSTRAINT subject_groups_uq UNIQUE (school_id, name)
);

CREATE TABLE subjects (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subject_group_id  bigint REFERENCES subject_groups(id) ON DELETE SET NULL,
    code              varchar(20) NOT NULL,      -- 'MATH'
    name              varchar(100) NOT NULL,     -- 'Mathématiques'
    ordering          smallint NOT NULL DEFAULT 0,
    CONSTRAINT subjects_uq UNIQUE (school_id, code)
);

-- US-05 CA1 : le coefficient appartient au couple (classe, matière).
CREATE TABLE classroom_subjects (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id     bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    classroom_id  bigint NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    subject_id    bigint NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    coefficient   numeric(4,2) NOT NULL DEFAULT 1.00,
    is_optional   boolean NOT NULL DEFAULT false,   -- RG-05
    weekly_hours  numeric(4,2),
    CONSTRAINT classroom_subjects_uq UNIQUE (classroom_id, subject_id),
    CONSTRAINT coefficient_chk CHECK (coefficient > 0)
);

-- US-06 : affectation enseignant × classe × matière
CREATE TABLE teacher_assignments (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id             bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    classroom_subject_id  bigint NOT NULL REFERENCES classroom_subjects(id) ON DELETE CASCADE,
    is_primary            boolean NOT NULL DEFAULT true,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT teacher_assignments_uq UNIQUE (teacher_id, classroom_subject_id)
);

-- =====================================================================
-- 3. ÉLÈVES ET TUTEURS
-- =====================================================================

CREATE TABLE students (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    matricule         varchar(30) NOT NULL,
    last_name         varchar(100) NOT NULL,
    first_name        varchar(150) NOT NULL,
    sexe              sexe_enum NOT NULL,
    birth_date        date NOT NULL,
    birth_place       varchar(120),
    nationality       varchar(60),
    photo_path        varchar(255),
    address           text,
    medical_notes     text,
    user_id           bigint REFERENCES users(id) ON DELETE SET NULL, -- accès élève
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz,
    CONSTRAINT students_matricule_uq UNIQUE (school_id, matricule)
);
CREATE INDEX students_name_trgm ON students USING gin ((last_name || ' ' || first_name) gin_trgm_ops);

CREATE TABLE guardians (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id     bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id       bigint REFERENCES users(id) ON DELETE SET NULL,  -- accès portail
    last_name     varchar(100) NOT NULL,
    first_name    varchar(150) NOT NULL,
    phone         varchar(30) NOT NULL,          -- D4 : obligatoire
    phone_alt     varchar(30),
    email         citext,
    profession    varchar(100),
    address       text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guardian_student (
    guardian_id   bigint NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
    student_id    bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    relationship  varchar(30) NOT NULL DEFAULT 'PARENT',  -- PERE, MERE, TUTEUR
    is_primary    boolean NOT NULL DEFAULT false,         -- destinataire des SMS
    is_payer      boolean NOT NULL DEFAULT false,
    PRIMARY KEY (guardian_id, student_id)
);
-- un seul contact principal par élève
CREATE UNIQUE INDEX guardian_student_primary_uq
    ON guardian_student (student_id) WHERE is_primary;

-- US-04 CA3 : la réinscription crée une nouvelle ligne, l'élève n'est pas dupliqué
CREATE TABLE enrollments (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id        bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year_id  bigint NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    classroom_id      bigint NOT NULL REFERENCES classrooms(id),
    status            enrollment_status_enum NOT NULL DEFAULT 'ACTIF',
    is_repeating      boolean NOT NULL DEFAULT false,
    enrolled_on       date NOT NULL DEFAULT CURRENT_DATE,
    left_on           date,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT enrollments_uq UNIQUE (student_id, academic_year_id)
);
CREATE INDEX enrollments_classroom_idx ON enrollments (classroom_id, status);

-- =====================================================================
-- 4. ÉVALUATIONS ET NOTES  (cœur du produit)
-- =====================================================================

CREATE TABLE assessment_types (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id   bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    code        varchar(20) NOT NULL,     -- 'DEVOIR', 'COMPO', 'INTERRO'
    name        varchar(80) NOT NULL,
    weight      numeric(4,2) NOT NULL DEFAULT 1.00,   -- RG-04 CUSTOM_WEIGHTS
    is_exam     boolean NOT NULL DEFAULT false,       -- true = composition
    CONSTRAINT assessment_types_uq UNIQUE (school_id, code)
);

CREATE TABLE assessments (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id             bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    classroom_subject_id  bigint NOT NULL REFERENCES classroom_subjects(id) ON DELETE CASCADE,
    period_id             bigint NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    assessment_type_id    bigint NOT NULL REFERENCES assessment_types(id),
    title                 varchar(150) NOT NULL,     -- 'Devoir n°1'
    bareme                numeric(5,2) NOT NULL DEFAULT 20.00,   -- RG-02
    weight                numeric(4,2) NOT NULL DEFAULT 1.00,    -- RG-03
    held_on               date,
    created_by            bigint REFERENCES users(id),
    is_locked             boolean NOT NULL DEFAULT false,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT assessments_bareme_chk CHECK (bareme > 0),
    CONSTRAINT assessments_weight_chk CHECK (weight > 0)
);
CREATE INDEX assessments_lookup_idx ON assessments (classroom_subject_id, period_id);

-- RG-01 : trois états — saisie / absent / non saisie
CREATE TABLE grades (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id      bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    assessment_id  bigint NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    enrollment_id  bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    score          numeric(5,2),                    -- NULL si absent ou non saisi
    is_absent      boolean NOT NULL DEFAULT false,  -- true => exclu du calcul
    comment        varchar(255),
    entered_by     bigint REFERENCES users(id),
    entered_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT grades_uq UNIQUE (assessment_id, enrollment_id),
    CONSTRAINT grades_score_chk CHECK (score IS NULL OR score >= 0),
    CONSTRAINT grades_absent_chk CHECK (NOT (is_absent AND score IS NOT NULL))
);
CREATE INDEX grades_enrollment_idx ON grades (enrollment_id);
-- Le contrôle score <= bareme est appliqué par trigger (le barème vit dans assessments).

CREATE OR REPLACE FUNCTION check_grade_within_bareme() RETURNS trigger AS $$
DECLARE v_bareme numeric(5,2);
BEGIN
    IF NEW.score IS NULL THEN RETURN NEW; END IF;
    SELECT bareme INTO v_bareme FROM assessments WHERE id = NEW.assessment_id;
    IF NEW.score > v_bareme THEN
        RAISE EXCEPTION 'Note % supérieure au barème % (évaluation %)',
              NEW.score, v_bareme, NEW.assessment_id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER grades_bareme_trg
    BEFORE INSERT OR UPDATE OF score ON grades
    FOR EACH ROW EXECUTE FUNCTION check_grade_within_bareme();

-- ---------------------------------------------------------------------
-- Résultats consolidés : dénormalisation assumée.
-- Recalculés par un job à chaque modification de note de la période.
-- Sans ces tables, un bulletin de classe = des milliers de requêtes.
-- ---------------------------------------------------------------------
CREATE TABLE period_subject_results (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id             bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id         bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    period_id             bigint NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    classroom_subject_id  bigint NOT NULL REFERENCES classroom_subjects(id) ON DELETE CASCADE,
    average               numeric(5,2),              -- RG-04, NULL si aucune note
    coefficient           numeric(4,2) NOT NULL,     -- figé au moment du calcul
    points                numeric(7,2),              -- average * coefficient
    rank                  smallint,                  -- RG-06, rang dans la matière
    class_average         numeric(5,2),
    class_min             numeric(5,2),
    class_max             numeric(5,2),
    appreciation          varchar(255),
    is_incomplete         boolean NOT NULL DEFAULT false,
    computed_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT psr_uq UNIQUE (enrollment_id, period_id, classroom_subject_id)
);
CREATE INDEX psr_period_idx ON period_subject_results (period_id, classroom_subject_id);

CREATE TABLE period_results (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id     bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    period_id         bigint NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    total_points      numeric(9,2),
    total_coefficient numeric(7,2),
    average           numeric(5,2),          -- RG-05
    rank              smallint,              -- RG-06
    class_size        smallint,
    class_average     numeric(5,2),
    class_min         numeric(5,2),
    class_max         numeric(5,2),
    mention           varchar(30),           -- RG-07
    absences_justified   smallint NOT NULL DEFAULT 0,
    absences_unjustified smallint NOT NULL DEFAULT 0,
    late_count           smallint NOT NULL DEFAULT 0,
    council_comment   text,                  -- US-10
    decision          decision_enum NOT NULL DEFAULT 'EN_ATTENTE',
    computed_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT period_results_uq UNIQUE (enrollment_id, period_id)
);
CREATE INDEX period_results_rank_idx ON period_results (period_id, average DESC);

CREATE TABLE annual_results (                 -- RG-08
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id     bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    average           numeric(5,2),
    rank              smallint,
    mention           varchar(30),
    decision          decision_enum NOT NULL DEFAULT 'EN_ATTENTE',
    council_comment   text,
    computed_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT annual_results_uq UNIQUE (enrollment_id)
);

-- =====================================================================
-- 5. VIE SCOLAIRE  (RG-09)
-- =====================================================================

CREATE TABLE attendances (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id      bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id  bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    period_id      bigint NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
    occurred_on    date NOT NULL,
    status         attendance_enum NOT NULL,
    duration_min   smallint NOT NULL DEFAULT 60,
    is_justified   boolean NOT NULL DEFAULT false,
    justification  varchar(255),
    subject_id     bigint REFERENCES subjects(id),
    recorded_by    bigint REFERENCES users(id),
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendances_lookup_idx ON attendances (enrollment_id, period_id, status);

CREATE TABLE sanctions (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id      bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id  bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    period_id      bigint REFERENCES periods(id),
    type           varchar(50) NOT NULL,   -- AVERTISSEMENT, BLAME, EXCLUSION_TEMP
    reason         text NOT NULL,
    starts_on      date,
    ends_on        date,
    issued_by      bigint REFERENCES users(id),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 6. SCOLARITÉ ET FINANCES  (RG-10 — modélisé maintenant, développé en V2)
-- =====================================================================

CREATE TABLE fee_types (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id   bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    code        varchar(30) NOT NULL,   -- 'INSCRIPTION', 'SCOLARITE', 'CANTINE'
    name        varchar(100) NOT NULL,
    is_recurring boolean NOT NULL DEFAULT false,
    CONSTRAINT fee_types_uq UNIQUE (school_id, code)
);

CREATE TABLE fee_schedules (          -- grille tarifaire d'un niveau pour une année
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year_id  bigint NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    level_id          bigint NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    fee_type_id       bigint NOT NULL REFERENCES fee_types(id),
    amount            bigint NOT NULL,               -- entier, RG-10
    CONSTRAINT fee_schedules_uq UNIQUE (academic_year_id, level_id, fee_type_id),
    CONSTRAINT fee_amount_chk CHECK (amount >= 0)
);

CREATE TABLE fee_installments (       -- tranches de la grille
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id        bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    fee_schedule_id  bigint NOT NULL REFERENCES fee_schedules(id) ON DELETE CASCADE,
    sequence         smallint NOT NULL,
    label            varchar(60) NOT NULL,           -- '1re tranche'
    amount           bigint NOT NULL,
    due_on           date NOT NULL,
    CONSTRAINT fee_installments_uq UNIQUE (fee_schedule_id, sequence)
);

CREATE TABLE student_fees (           -- ce que doit réellement un élève (remises incluses)
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id        bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id    bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    fee_type_id      bigint NOT NULL REFERENCES fee_types(id),
    amount_due       bigint NOT NULL,
    discount         bigint NOT NULL DEFAULT 0,
    discount_reason  varchar(150),
    CONSTRAINT student_fees_uq UNIQUE (enrollment_id, fee_type_id),
    CONSTRAINT student_fees_chk CHECK (discount >= 0 AND discount <= amount_due)
);

CREATE TABLE payments (               -- immuable une fois validé (RG-10)
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id      bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id  bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    receipt_no     varchar(30) NOT NULL,
    amount         bigint NOT NULL,
    method         payment_method_enum NOT NULL DEFAULT 'ESPECES',
    reference      varchar(80),                 -- n° transaction Mobile Money
    paid_on        date NOT NULL DEFAULT CURRENT_DATE,
    received_by    bigint REFERENCES users(id),
    is_voided      boolean NOT NULL DEFAULT false,
    voided_reason  varchar(255),
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payments_receipt_uq UNIQUE (school_id, receipt_no),
    CONSTRAINT payments_amount_chk CHECK (amount > 0)
);
CREATE INDEX payments_enrollment_idx ON payments (enrollment_id, paid_on);

CREATE TABLE payment_allocations (    -- imputation d'un paiement sur les tranches
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id          bigint NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    fee_installment_id  bigint NOT NULL REFERENCES fee_installments(id),
    amount              bigint NOT NULL,
    CONSTRAINT allocation_amount_chk CHECK (amount > 0)
);

-- =====================================================================
-- 7. COMMUNICATION ET TRAÇABILITÉ
-- =====================================================================

CREATE TABLE notifications (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id     bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    channel       varchar(20) NOT NULL,      -- SMS, WHATSAPP, EMAIL, PUSH, IN_APP
    recipient     varchar(120) NOT NULL,
    user_id       bigint REFERENCES users(id) ON DELETE SET NULL,
    template      varchar(60),
    body          text NOT NULL,
    status        varchar(20) NOT NULL DEFAULT 'QUEUED', -- QUEUED, SENT, FAILED
    provider_ref  varchar(120),
    cost          bigint,
    sent_at       timestamptz,
    error         text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_status_idx ON notifications (status, created_at);

-- RG-11 : journal d'audit, non modifiable
CREATE TABLE audit_logs (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id     bigint REFERENCES schools(id) ON DELETE CASCADE,
    user_id       bigint REFERENCES users(id) ON DELETE SET NULL,
    action        varchar(50) NOT NULL,      -- CREATE, UPDATE, DELETE, LOGIN, EXPORT, CASH_OPEN, CASH_DEPOSIT, etc.
    auditable_type varchar(80) NOT NULL,     -- 'Grade', 'Payment', 'CashDesk', 'User', ...
    auditable_id  bigint NOT NULL,
    old_values    jsonb,
    new_values    jsonb,
    ip_address    inet,
    user_agent    varchar(255),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_target_idx ON audit_logs (auditable_type, auditable_id);
CREATE INDEX audit_logs_date_idx   ON audit_logs (created_at DESC);

-- =====================================================================
-- 8. GESTION DES CAISSES, PÉRIMÈTRES DE DONNÉES ET ÉCOLAGE AVANCÉ
-- =====================================================================

-- Caisses de l'établissement (Principale et Secondaires)
CREATE TABLE cash_desks (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id           bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    code                varchar(30) NOT NULL,              -- 'CAISSE-PRIN', 'CAISSE-01', 'CAISSE-02'
    name                varchar(100) NOT NULL,             -- 'Caisse Principale', 'Caisse Secondaire 2'
    type                varchar(20) NOT NULL DEFAULT 'SECONDAIRE', -- 'PRINCIPALE', 'SECONDAIRE'
    parent_cash_desk_id bigint REFERENCES cash_desks(id) ON DELETE SET NULL,
    status              varchar(20) NOT NULL DEFAULT 'ACTIVE',    -- 'ACTIVE', 'PAUSED', 'CLOSED'
    current_balance     bigint NOT NULL DEFAULT 0,         -- Solde comptable en XOF
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_desks_uq UNIQUE (school_id, code)
);
CREATE INDEX cash_desks_school_type_idx ON cash_desks (school_id, type);

-- Affectation d'un ou plusieurs utilisateurs à une caisse
CREATE TABLE cash_desk_assignments (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id     bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    cash_desk_id  bigint NOT NULL REFERENCES cash_desks(id) ON DELETE CASCADE,
    user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_active     boolean NOT NULL DEFAULT true,
    assigned_by   bigint REFERENCES users(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_desk_user_uq UNIQUE (cash_desk_id, user_id)
);

-- Sessions de caisse (journalière / par tranche d'activité)
CREATE TABLE cash_desk_sessions (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id                   bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    cash_desk_id                bigint NOT NULL REFERENCES cash_desks(id) ON DELETE CASCADE,
    user_id                     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status                      varchar(20) NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'PAUSED', 'CLOSED'
    opened_at                   timestamptz NOT NULL DEFAULT now(),
    paused_at                   timestamptz,
    closed_at                   timestamptz,
    opening_balance             bigint NOT NULL DEFAULT 0,
    theoretical_closing_balance bigint,
    physical_closing_balance    bigint,
    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_sessions_lookup_idx ON cash_desk_sessions (cash_desk_id, user_id, status);

-- Dépôts inter-caisses : Caisse Secondaire -> Caisse Principale
CREATE TABLE cash_deposits (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id             bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    reference             varchar(50) NOT NULL,                     -- 'DEP-2026-0001'
    source_cash_desk_id   bigint NOT NULL REFERENCES cash_desks(id), -- Caisse Secondaire émettrice
    target_cash_desk_id   bigint NOT NULL REFERENCES cash_desks(id), -- Caisse Principale réceptrice
    amount                bigint NOT NULL,                          -- Montant en XOF
    status                varchar(20) NOT NULL DEFAULT 'PENDING',   -- 'PENDING', 'VALIDATED', 'REJECTED'
    submitted_by          bigint NOT NULL REFERENCES users(id),     -- Caissier secondaire
    submitted_at          timestamptz NOT NULL DEFAULT now(),
    validated_by          bigint REFERENCES users(id),             -- Caissier principal validateur
    validated_at          timestamptz,
    rejection_reason      varchar(255),
    CONSTRAINT cash_deposit_amount_chk CHECK (amount > 0),
    CONSTRAINT cash_deposit_ref_uq UNIQUE (school_id, reference)
);
CREATE INDEX cash_deposits_status_idx ON cash_deposits (school_id, status);

-- Périmètres de données des utilisateurs (RBAC Data Scope)
CREATE TABLE user_data_scopes (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id           bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_type        varchar(30) NOT NULL, -- 'GLOBAL', 'SCHOOL', 'LEVEL', 'CLASS', 'CASH_DESK', 'GROUP', 'USER'
    scope_entity_ids  jsonb NOT NULL DEFAULT '[]'::jsonb, -- Liste des IDs autorisés (ex. [2] pour Caisse 2)
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_data_scopes_uq UNIQUE (user_id, scope_type)
);

-- Cas de réduction de scolarité
CREATE TABLE discount_cases (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id     bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    code          varchar(30) NOT NULL,                     -- 'BOURSIER_ETAT', 'PERSONNEL_ECOLE', 'FAMILLE_3'
    label         varchar(100) NOT NULL,                    -- 'Bourse Nationale de l''État'
    discount_type varchar(20) NOT NULL DEFAULT 'PERCENTAGE',-- 'PERCENTAGE', 'FIXED_AMOUNT'
    value         numeric(10,2) NOT NULL,                   -- ex. 20.00 (%) ou 50000 (XOF)
    applies_to    varchar(20) NOT NULL DEFAULT 'TOUS',      -- 'AFFECTE', 'PRIVE', 'TOUS'
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT discount_cases_uq UNIQUE (school_id, code)
);

-- Échéanciers particuliers par inscription élève
CREATE TABLE personal_schedules (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id         bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    enrollment_id     bigint NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    installments_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    agreed_by         bigint REFERENCES users(id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT personal_schedules_uq UNIQUE (enrollment_id)
);

-- ---------------------------------------------------------------------
-- 9. Pédagogie Avancée, Emplois du Temps, Devoirs et Normes Horaires
-- ---------------------------------------------------------------------

-- Normes horaires de l'établissement
CREATE TABLE time_norms (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id               bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    day_start_time          time NOT NULL DEFAULT '07:30',
    day_end_time            time NOT NULL DEFAULT '18:00',
    session_duration_min    int NOT NULL DEFAULT 55,
    recreation_duration_min int NOT NULL DEFAULT 15,
    lunch_break_start       time NOT NULL DEFAULT '12:00',
    lunch_break_end         time NOT NULL DEFAULT '14:00',
    max_hours_per_day       int NOT NULL DEFAULT 7,
    max_hours_per_week      int NOT NULL DEFAULT 32,
    working_days            jsonb NOT NULL DEFAULT '["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI"]'::jsonb,
    available_slots         jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT time_norms_school_uq UNIQUE (school_id)
);

-- Plannings & créneaux horaires individuels des enseignants
CREATE TABLE teacher_schedules (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id               bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id              bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_of_week             varchar(15) NOT NULL, -- 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'
    start_time              time NOT NULL,
    end_time                time NOT NULL,
    subject_id              bigint REFERENCES subjects(id) ON DELETE CASCADE,
    classroom_id            bigint REFERENCES classrooms(id) ON DELETE CASCADE,
    room_number             varchar(50),
    is_active               boolean NOT NULL DEFAULT true,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT teacher_sched_time_chk CHECK (start_time < end_time)
);
CREATE INDEX teacher_sched_lookup_idx ON teacher_schedules (school_id, teacher_id, day_of_week);

-- Grilles d'emplois du temps (par classe ou par niveau)
CREATE TABLE timetables (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id               bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year_id        bigint NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    classroom_id            bigint NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    period_id               bigint REFERENCES periods(id) ON DELETE SET NULL,
    name                    varchar(100) NOT NULL, -- 'Emploi du temps 4EME 5 - T1'
    status                  varchar(20) NOT NULL DEFAULT 'VALIDE', -- 'BROUILLON', 'VALIDE', 'ARCHIVE'
    is_active               boolean NOT NULL DEFAULT true,
    created_by              bigint REFERENCES users(id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timetables_class_idx ON timetables (school_id, classroom_id, academic_year_id);

-- Créneaux détaillés d'un emploi du temps
CREATE TABLE timetable_slots (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timetable_id            bigint NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
    day_of_week             varchar(15) NOT NULL,
    slot_label              varchar(30) NOT NULL, -- '07h30-08h25'
    start_time              time NOT NULL,
    end_time                time NOT NULL,
    subject_id              bigint NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id              bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_number             varchar(50),
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT slot_time_chk CHECK (start_time < end_time)
);
CREATE INDEX timetable_slots_idx ON timetable_slots (timetable_id, day_of_week);

-- Cahier de devoirs / travaux dirigés
CREATE TABLE homeworks (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id               bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year_id        bigint NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    classroom_id            bigint NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    subject_id              bigint NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id              bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title                   varchar(200) NOT NULL,
    description             text,
    due_date                date NOT NULL,
    status                  varchar(20) NOT NULL DEFAULT 'BROUILLON', -- 'BROUILLON', 'PUBLIE', 'TERMINE', 'ARCHIVE'
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX homeworks_lookup_idx ON homeworks (school_id, classroom_id, subject_id, status);

-- Documents administratifs et pédagogiques de l'établissement
CREATE TABLE administrative_documents (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id               bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    title                   varchar(200) NOT NULL,
    category                varchar(50) NOT NULL, -- 'PEDAGOGIQUE', 'ADMINISTRATIF', 'EVALUATION', 'DISCIPLINE'
    target_type             varchar(30) NOT NULL DEFAULT 'ETABLISSEMENT', -- 'CLASSE', 'ELEVE', 'ENSEIGNANT', 'ETABLISSEMENT'
    target_id               bigint,
    file_ref                varchar(255),
    academic_year_id        bigint REFERENCES academic_years(id),
    status                  varchar(20) NOT NULL DEFAULT 'ACTIF', -- 'ACTIF', 'ARCHIVE'
    created_by              bigint REFERENCES users(id),
    created_at              timestamptz NOT NULL DEFAULT now()
);
-- ---------------------------------------------------------------------
-- 10. MODULE DE RELANCE AUTOMATISÉE DE PAIEMENT (CAISSE & ÉCOLAGE)
-- ---------------------------------------------------------------------

-- Règles et périodicités de relance automatisée
CREATE TABLE payment_reminder_rules (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id               bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name                    varchar(120) NOT NULL, -- 'Relance Mensuelle Écolage', 'Alerte J-5 Échéance'
    periodicity             varchar(30) NOT NULL DEFAULT 'MENSUEL', -- 'HEBDOMADAIRE', 'MENSUEL', 'TRIMESTRIEL', 'ECHEANCE_DELTA'
    days_trigger            int NOT NULL DEFAULT 5, -- Jour du mois (ex: 5) ou delta en jours avant/après échéance
    is_active               boolean NOT NULL DEFAULT true,
    channels                jsonb NOT NULL DEFAULT '["NOTIFICATION", "SMS", "EMAIL"]'::jsonb,
    sms_template            text,
    email_template          text,
    created_by              bigint REFERENCES users(id),
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_reminder_rules_idx ON payment_reminder_rules (school_id, is_active);

-- Journal & historique exhaustif de chaque relance émise
CREATE TABLE payment_reminder_logs (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id               bigint NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    rule_id                 bigint REFERENCES payment_reminder_rules(id) ON DELETE SET NULL,
    reference               varchar(50) NOT NULL, -- 'REL-2026-0001'
    enrollment_id           bigint REFERENCES enrollments(id) ON DELETE CASCADE,
    student_name            varchar(150) NOT NULL,
    classroom_name          varchar(60) NOT NULL,
    tutor_name              varchar(150),
    contact                 varchar(120) NOT NULL, -- Numéro téléphone ou adresse email
    amount_due              bigint NOT NULL, -- Solde exigible en XOF
    channel                 varchar(30) NOT NULL, -- 'SMS', 'EMAIL', 'NOTIFICATION', 'FICHE_PAPIER'
    status                  varchar(30) NOT NULL DEFAULT 'DISTRIBUE', -- 'DISTRIBUE', 'ENVOYE', 'IMPRIME', 'ECHEC'
    operator_id             bigint REFERENCES users(id) ON DELETE SET NULL, -- Utilisateur ou NULL si automate système
    operator_name           varchar(120) NOT NULL DEFAULT 'Automate Système',
    message_content         text,
    dispatched_at           timestamptz NOT NULL DEFAULT now(),
    created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_reminder_logs_idx ON payment_reminder_logs (school_id, dispatched_at DESC, channel);
CREATE INDEX payment_reminder_logs_enrollment_idx ON payment_reminder_logs (enrollment_id);

COMMIT;

-- =====================================================================
-- Vue utilitaire : solde de scolarité par inscription
-- =====================================================================
CREATE OR REPLACE VIEW v_student_balances AS
SELECT
    e.id                                        AS enrollment_id,
    e.school_id,
    e.student_id,
    COALESCE(SUM(DISTINCT sf.amount_due - sf.discount), 0) AS total_due,
    COALESCE(p.total_paid, 0)                   AS total_paid,
    COALESCE(SUM(DISTINCT sf.amount_due - sf.discount), 0) - COALESCE(p.total_paid, 0) AS balance
FROM enrollments e
LEFT JOIN student_fees sf ON sf.enrollment_id = e.id
LEFT JOIN LATERAL (
    SELECT SUM(amount) AS total_paid
    FROM payments
    WHERE enrollment_id = e.id AND NOT is_voided
) p ON true
GROUP BY e.id, e.school_id, e.student_id, p.total_paid;
