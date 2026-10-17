const test = require("node:test");
const assert = require("node:assert/strict");
const { DbmlError } = require("../src");
const { generate, loadGenerated } = require("./helpers");

const has = (output, line) => assert.ok(output.includes(line), `missing:\n${line}\n\nin:\n${output}`);
const users = "Table users {\n  id int [pk]\n}\n";

test("many-to-one gives one() on the foreign key side and many() on the other", () => {
  const output = generate(`${users}Table posts {\n  author_id int [ref: > users.id]\n}\n`);

  has(output, 'import { relations } from "drizzle-orm";');
  has(
    output,
    "export const usersRelations = relations(users, ({ many }) => ({\n  posts: many(posts),\n}));"
  );
  has(
    output,
    "export const postsRelations = relations(posts, ({ one }) => ({\n" +
      "  author: one(users, { fields: [posts.author_id], references: [users.id] }),\n}));"
  );
});

test("< is resolved like >", () => {
  const forward = generate(`${users}Table posts {\n  author_id int\n}\nRef: posts.author_id > users.id\n`);
  const backward = generate(`${users}Table posts {\n  author_id int\n}\nRef: users.id < posts.author_id\n`);

  assert.equal(forward, backward);
});

test("one-to-one gives one() on both sides", () => {
  const output = generate(`${users}Table profiles {\n  user_id int [ref: - users.id]\n}\n`);

  has(output, "  profiles: one(profiles),");
  has(output, "  user: one(users, { fields: [profiles.user_id], references: [users.id] }),");
});

test("a self-reference gets a relationName", () => {
  const output = generate("Table users {\n  id int [pk]\n  manager_id int [ref: > users.id]\n}\n");

  has(output, '  manager: one(users, { fields: [users.manager_id], references: [users.id], relationName: "users_manager_id" }),');
  has(output, '  users_by_manager_id: many(users, { relationName: "users_manager_id" }),');
});

test("two references between the same tables get distinct names", () => {
  const output = generate(`${users}Table posts {\n  author_id int [ref: > users.id]\n  editor_id int [ref: > users.id]\n}\n`);

  has(output, '  author: one(users, { fields: [posts.author_id], references: [users.id], relationName: "posts_author_id" }),');
  has(output, '  editor: one(users, { fields: [posts.editor_id], references: [users.id], relationName: "posts_editor_id" }),');
  has(output, '  posts_by_author_id: many(posts, { relationName: "posts_author_id" }),');
  has(output, '  posts_by_editor_id: many(posts, { relationName: "posts_editor_id" }),');
});

test("a composite reference is named after the target table", () => {
  const output = generate(`Table b {
  x int
  y int
  indexes {
    (x, y) [pk]
  }
}
Table a {
  x int
  y int
}
Ref: a.(x, y) > b.(x, y)
`);

  has(output, "  b: one(b, { fields: [a.x, a.y], references: [b.x, b.y] }),");
  has(output, "  a: many(a),");
});

test("a column without _id, or a name taken by a column, gives <column>_<target>", () => {
  const output = generate(
    `${users}Table posts {\n  author varchar\n  author_id int [ref: > users.id]\n  approved_by int [ref: > users.id]\n}\n`
  );

  has(output, '  author_id_users: one(users, { fields: [posts.author_id], references: [users.id], relationName: "posts_author_id" }),');
  has(output, '  approved_by_users: one(users, { fields: [posts.approved_by], references: [users.id], relationName: "posts_approved_by" }),');
});

test("a name that is still taken is an error naming the table", () => {
  const dbml = `${users}Table posts {\n  author varchar\n  author_id_users varchar\n  author_id int [ref: > users.id]\n}\n`;

  assert.throws(() => generate(dbml), (error) => {
    assert.ok(error instanceof DbmlError);
    assert.match(error.message, /posts: Relation 'author_id_users' collides with a column or relation of 'posts'/);
    return true;
  });
});

test("tables without relationships get no relations, others follow file order", () => {
  const output = generate(`Table logs {\n  id int\n}\nTable posts {\n  author_id int [ref: > users.id]\n}\n${users}`);

  assert.doesNotMatch(output, /logsRelations/);
  assert.ok(output.indexOf("postsRelations") < output.indexOf("usersRelations"));
  assert.doesNotMatch(generate("Table logs {\n  id int\n}\n"), /relations/);
});

test("the generated relations load with drizzle-orm", async () => {
  const module = await loadGenerated(
    generate("Table users {\n  id int [pk]\n  manager_id int [ref: > users.id]\n}\nTable posts {\n  author_id int [ref: > users.id]\n}\n")
  );

  assert.ok(module.usersRelations);
  assert.ok(module.postsRelations);
});
