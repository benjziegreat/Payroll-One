-- Payroll One: local MySQL fallback schema (mirrors supabase/schema.sql).
-- Applied automatically by `npm run local:db:init`.

-- Named clock-in/out anchor points. Every user is assigned to one (id 1,
-- "Main Office", is the default seeded below) and their geofence is measured
-- against whichever location they're assigned to.
CREATE TABLE IF NOT EXISTS office_locations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  latitude DOUBLE NULL,
  longitude DOUBLE NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO office_locations (id, name) VALUES (1, 'Main Office');

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role ENUM('employee', 'admin') NOT NULL DEFAULT 'employee',
  office_location_id INT NOT NULL DEFAULT 1,
  bypass_geofence TINYINT(1) NOT NULL DEFAULT 0,
  photo_url VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_office_location FOREIGN KEY (office_location_id) REFERENCES office_locations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS face_enrollments (
  user_id CHAR(36) PRIMARY KEY,
  descriptor JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_face_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id VARCHAR(255) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_webauthn_cred_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_webauthn_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  user_id CHAR(36) PRIMARY KEY,
  challenge VARCHAR(255) NOT NULL,
  challenge_type ENUM('registration', 'authentication') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_webauthn_chal_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Challenges for the kiosk (no-login, "who is this") fingerprint flow, where
-- there's no user_id yet to key off of — the user is only known once the
-- assertion comes back and we look up its credential_id.
CREATE TABLE IF NOT EXISTS webauthn_kiosk_challenges (
  challenge VARCHAR(255) PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance_logs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  action ENUM('login', 'logout') NOT NULL,
  method ENUM('face', 'fingerprint') NOT NULL,
  latitude DOUBLE NULL,
  longitude DOUBLE NULL,
  -- When the action actually happened on the device, for events queued while
  -- offline and synced later. NULL means "same as created_at" (the normal,
  -- online path). created_at always reflects when the server received it.
  occurred_at TIMESTAMP NULL,
  -- Client-generated id so a retried offline sync can't double-insert.
  client_event_id VARCHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_attendance_user_created (user_id, created_at DESC),
  UNIQUE KEY uq_attendance_client_event (client_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
