import { DatabaseSync } from "node:sqlite";
export function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  return {
    sqlite,
    async batch(statements) { sqlite.exec("BEGIN"); try { const results=[]; for(const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; } catch(error) { sqlite.exec("ROLLBACK"); throw error; } },
    prepare(sql) {
      const state = { args: [] };
      return {
        bind(...args) { state.args = args; return this; },
        async first() { return sqlite.prepare(sql).get(...state.args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...state.args) }; },
        async run() { const result = sqlite.prepare(sql).run(...state.args); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
      };
    },
  };
}
export function sessionUser(DB, role, cookie) {
  const name = role + "-account";
  const result = DB.sqlite.prepare("INSERT INTO users (username,email,password_hash,role,profile_json,created_at) VALUES (?, '', '', ?, '{}', ?)").run(name, role, new Date().toISOString());
  const token = "session-" + role;
  DB.sqlite.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(token, Number(result.lastInsertRowid), Math.floor(Date.now()/1000)+3600);
  return `${cookie}=${token}`;
}
export function request(path, cookie, method="GET", body) {
  return new Request("https://example.test"+path, { method, headers: { ...(cookie ? {Cookie:cookie}:{}), "Content-Type":"application/json" }, ...(body ? {body:JSON.stringify(body)}:{}) });
}
