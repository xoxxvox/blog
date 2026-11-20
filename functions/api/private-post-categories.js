import { json, errorJson, getSessionUser } from "./_lib.js";
import { can } from "./_permissions.js";
import { ensurePrivatePosts, postCategories, validCategory } from "./_private-posts.js";
export async function onRequestGet({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user=await getSessionUser(request,env); if(!user||!await can(env,user,"private_read")) return errorJson("无权访问隐秘空间分类",403);
  await ensurePrivatePosts(env);return json({categories:await postCategories(env)},200,{"Cache-Control":"private, no-store"});
}
export async function onRequestPost({ request, env }) {
  if (!env.DB) return errorJson("未绑定 D1 数据库", 500);
  const user=await getSessionUser(request,env);if(user?.role!=="admin")return errorJson("仅管理员可管理隐秘文章分类",403);
  await ensurePrivatePosts(env);let body;try{body=await request.json()}catch{return errorJson("请求格式无效",400)}
  const name=String(body.name||"").trim(),next=String(body.nextName||"").trim(),list=await postCategories(env);
  if(!validCategory(name))return errorJson("分类名称需为 1 至 30 字",400);
  let operations=[];
  if(body.action==="create") {if(list.includes(name))return errorJson("分类已存在",409);if(list.length>=8)return errorJson("最多 8 个独立分类",400);operations.push(env.DB.prepare("INSERT INTO private_post_categories(name) SELECT ? WHERE (SELECT COUNT(*) FROM private_post_categories) < 8").bind(name));}
  else if(body.action==="rename"||body.action==="delete") {
    if(!list.includes(name))return errorJson("分类不存在",400);
    if(body.action==="rename") {if(!validCategory(next)||list.includes(next))return errorJson("新名称无效或已存在",400);operations.push(env.DB.prepare("UPDATE private_post_categories SET name=? WHERE name=?").bind(next,name));operations.push(env.DB.prepare("UPDATE private_posts SET category=? WHERE category=?").bind(next,name));}
    else {const remaining=list.filter(item=>item!==name);if(!remaining.length)return errorJson("至少保留一个分类",400);const fallback=remaining.includes("未分类")?"未分类":remaining[0];operations.push(env.DB.prepare("DELETE FROM private_post_categories WHERE name=?").bind(name));operations.push(env.DB.prepare("UPDATE private_posts SET category=? WHERE category=?").bind(fallback,name));}
  }else return errorJson("不支持的操作",400);
  const results=await env.DB.batch(operations);if(body.action==="create"&&!results[0].meta?.changes)return errorJson("最多 8 个独立分类",400);return json({ok:true,categories:await postCategories(env)});
}
