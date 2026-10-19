const test = require("node:test");
const assert = require("node:assert/strict");
const { generateDbPatch } = require("../src");

/**
 * Regression baseline for feature 009 (ES module entry and type
 * declarations): the exact db-patch.dbml output, recorded before any source
 * change, for the DBML of tests/pg-regression.test.js. The feature MUST NOT
 * change it.
 */
const dbml = `Table accounts [note: 'People who sign in'] {
  id integer [pk, increment]
  email varchar(255) [unique, not null, note: 'Login name']
  name char(40)
  status account_status [not null, default: 'active']
  kind enum('person', 'company') [default: 'person']
  balance decimal(10, 2) [default: 0]
  verified boolean [default: false]
  score real
  ratio float
  visits bigint [default: 0]
  rank smallint
  prefs jsonb
  raw json
  token uuid
  born date
  wakes_at time
  created_at timestamptz [default: \`now()\`]
  updated_at timestamp [default: \`CURRENT_TIMESTAMP\`]
  manager_id integer [ref: > accounts.id, delete: set null, update: cascade]
  seats integer [check: \`seats > 0\`]

  indexes {
    name
    (name, created_at) [unique, name: 'accounts_name_created']
    \`lower(email)\` [unique, name: 'accounts_email_ci', where: \`verified = true\`]
    \`(prefs -> 'tags')\` [type: gin, name: 'accounts_tags']
  }

  checks {
    \`balance >= 0\` [name: 'accounts_balance_positive']
  }
}

Table teams {
  id integer [pk]
  title text
  Note {
    'Groups of accounts'
  }
}

Table memberships {
  account_id integer [ref: > accounts.id, delete: cascade]
  team_id integer
  role account_status

  indexes {
    (account_id, team_id) [pk]
  }
}

Table membership_notes {
  account_id integer
  team_id integer
  body text
}

Ref: memberships.team_id > teams.id [delete: restrict]
Ref: membership_notes.(account_id, team_id) > memberships.(account_id, team_id) [delete: cascade]

Enum account_status {
  Note: 'Account lifecycle'
  active
  closed [note: 'no longer used']
}
`;

const expected = `Table accounts [note: 'People who sign in'] {
  id integer [pk, increment]
  email varchar(255) [unique, not null, note: 'Login name']
  name char(40)
  status account_status [not null, default: 'active']
  kind enum('person', 'company') [default: 'person']
  balance decimal(10, 2) [default: 0]
  verified boolean [default: false]
  score real
  ratio float
  visits bigint [default: 0]
  rank smallint
  prefs jsonb
  raw json
  token uuid
  born date
  wakes_at time
  created_at timestamptz [default: \`now()\`]
  updated_at timestamp [default: \`CURRENT_TIMESTAMP\`]
  manager_id integer
  seats integer [check: \`seats > 0\`]

  indexes {
    name
    (name, created_at) [unique, name: 'accounts_name_created']
    \`lower(email)\` [unique, name: 'accounts_email_ci', note: 'where verified = true']
    \`(prefs -> 'tags')\` [type: gin, name: 'accounts_tags']
  }

  checks {
    \`balance >= 0\` [name: 'accounts_balance_positive']
  }
}

Table teams {
  id integer [pk]
  title text
  Note {
    'Groups of accounts'
  }
}

Table memberships {
  account_id integer
  team_id integer
  role account_status

  indexes {
    (account_id, team_id) [pk]
  }
}

Table membership_notes {
  account_id integer
  team_id integer
  body text
}

Ref: memberships.team_id > teams.id [delete: restrict]
Ref: membership_notes.(account_id, team_id) > memberships.(account_id, team_id) [delete: cascade]

Enum account_status {
  active [note: 'Account lifecycle']
  closed [note: 'no longer used']
}

// Relationships moved from inline settings by dbml2drizzle
Ref: accounts.manager_id > accounts.id [delete: set null, update: cascade]
Ref: memberships.account_id > accounts.id [delete: cascade]
`;

test("db-patch.dbml output is unchanged", () => {
  assert.equal(generateDbPatch(dbml), expected);
});

test("db-patch.dbml output is deterministic", () => {
  assert.equal(generateDbPatch(dbml), generateDbPatch(dbml));
});
