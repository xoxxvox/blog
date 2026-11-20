import { json, errorJson, getSessionUser } from "./_lib.js";
import { can, isSuperAdmin } from "./_permissions.js";
async function ensure(env) { await env.DB.prepare("CREATE TABLE IF NOT EXISTS private_bio (id INTEGER PRIMARY KEY CHECK(id=1), bio_json TEXT NOT NULL)").run(); }
export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env);
  if (!user || !await can(env, user, "private_read")) return errorJson("无权读取隐秘空间个人简介", 403);
  await ensure(env); const row = await env.DB.prepare("SELECT bio_json FROM private_bio WHERE id=1").first();
  return json({ bio: row ? JSON.parse(row.bio_json) : null }, 200, { "Cache-Control": "private, no-store", Vary: "Cookie" });
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user = await getSessionUser(request, env); if (!isSuperAdmin(user)) return errorJson("仅后台最高权限管理员可设置隐秘空间资料", 403);
  let body; try { body = (await request.json()).bio; } catch { return errorJson("请求格式无效", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorJson("资料格式无效", 400);
  await ensure(env);
  const existingRow = await env.DB.prepare("SELECT bio_json FROM private_bio WHERE id=1").first();
  const existing = existingRow ? JSON.parse(existingRow.bio_json) : {};
  const text=(value,max=200)=>String(value||"").trim().slice(0,max);
  const info=body.info||{},labels=info.labels||{};
  const contacts = Array.isArray(body.contacts)
    ? body.contacts
        .filter(c => c && typeof c === "object" && (text(c.label, 40) || text(c.value, 200)))
        .slice(0, 10)
        .map(c => {
          const label = text(c.label, 40) || "联系";
          return {
            label,
            modalTitle: text(c.modalTitle, 60) || `${label} 联系方式`,
            fieldLabel: text(c.fieldLabel, 40) || "账号",
            value: text(c.value, 200),
            url: text(c.url, 500),
            qr: text(c.qr, 4096),
          };
        })
    : (Array.isArray(existing.contacts) ? existing.contacts : []);
  const bio={enabled:Boolean(body.enabled),avatar:text(body.avatar,4096),profileName:text(body.profileName,100),profilePhoto:text(body.profilePhoto,4096),profilePhotoCaption:text(body.profilePhotoCaption,100),profilePhotoEnabled:body.profilePhotoEnabled!==false,tags:Array.isArray(body.tags)?body.tags.map(t=>text(t,30)).filter(Boolean).slice(0,8):[],info:{name:text(info.name),gender:text(info.gender),age:text(info.age),labels:{name:text(labels.name,30)||"姓名",gender:text(labels.gender,30)||"性别",age:text(labels.age,30)||"年龄"},extraInfo:Array.isArray(info.extraInfo)?info.extraInfo.filter(row=>row&&text(row.label,30)).slice(0,4).map(row=>({label:text(row.label,30),value:text(row.value)})):[]},contacts};
  await env.DB.prepare("INSERT INTO private_bio(id,bio_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET bio_json=excluded.bio_json").bind(JSON.stringify(bio)).run();
  return json({ok:true,bio});
}
