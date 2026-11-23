import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1, sessionUser, request } from './d1-fixture.mjs';
import * as posts from '../functions/api/private-posts.js';
import * as categories from '../functions/api/private-post-categories.js';
import * as bio from '../functions/api/private-bio.js';
import * as content from '../functions/api/content.js';
import { CATALOG, defaults, loadPolicies } from '../functions/api/_permissions.js';
async function setup() {
 const DB=createD1();DB.sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const env={DB},cookies=Object.fromEntries(['guest','user','advanced','vip','admin'].map(role=>[role,sessionUser(DB,role,'blog_session')]));
 DB.sqlite.prepare('INSERT INTO private_posts(id,title,excerpt,body,category,date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('legacy','历史手记','摘要','PRIVATE-SENTINEL','未分类','2026-11-20','2026-11-20','2026-11-20');
 return {DB,env,cookies};
}
test('historical articles remain intact, are absent from public content, and only administrators can read or export',async()=>{
 const {DB,env,cookies}=await setup();
 for(const role of [null,'guest','user','advanced','vip']) for(const path of ['/api/private-posts','/api/private-posts?id=legacy','/api/private-posts?id=legacy&download=1']) assert.equal((await posts.onRequestGet({env,request:request(path,cookies[role])})).status,403);
 const admin=path=>posts.onRequestGet({env,request:request(path,cookies.admin)});
 assert.equal((await (await admin('/api/private-posts')).json()).posts.length,1);
 const detail=await admin('/api/private-posts?id=legacy');assert.equal(detail.headers.get('Cache-Control'),'private, no-store');assert.equal((await detail.json()).post.body,'PRIVATE-SENTINEL');
 assert.match(await (await admin('/api/private-posts?id=legacy&download=1')).text(),/PRIVATE-SENTINEL/);
 assert.equal((await (await content.onRequestGet({env,request:request('/api/content')})).text()).includes('PRIVATE-SENTINEL'),false);
 assert.equal((await posts.onRequestPost()).status,410);assert.equal((await posts.onRequestDelete()).status,410);
 assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM private_posts').get().n,1);
});
test('retired category and profile settings cannot be changed or read by VIP; historical data stays unchanged',async()=>{
 const {DB,env,cookies}=await setup();
 DB.sqlite.exec("CREATE TABLE IF NOT EXISTS private_bio(id INTEGER PRIMARY KEY,bio_json TEXT NOT NULL)");DB.sqlite.prepare('INSERT INTO private_bio VALUES(1,?)').run(JSON.stringify({profileName:'PRIVATE-PROFILE'}));
 assert.equal((await categories.onRequestPost()).status,410);assert.equal((await bio.onRequestPost()).status,410);
 assert.equal((await bio.onRequestGet({env,request:request('/api/private-bio',cookies.vip)})).status,403);
 assert.equal((await categories.onRequestGet({env,request:request('/api/private-post-categories',cookies.vip)})).status,403);
 assert.equal((await (await bio.onRequestGet({env,request:request('/api/private-bio',cookies.admin)})).json()).bio.profileName,'PRIVATE-PROFILE');
 assert.equal(DB.sqlite.prepare('SELECT body FROM private_posts').get().body,'PRIVATE-SENTINEL');
});
test('legacy stored permission rows discard retired grants and preserve all unrelated policy choices',async()=>{
 const {DB,env}=await setup();DB.sqlite.exec("CREATE TABLE IF NOT EXISTS access_policies(scope TEXT PRIMARY KEY,policies_json TEXT)");const p={...defaults(),vip:['private_read','private_export']};p.user=[];
 DB.sqlite.prepare('INSERT INTO access_policies(scope,policies_json) VALUES(?,?)').run('blog',JSON.stringify(p));
 const loaded=await loadPolicies(env);assert.deepEqual(loaded.user,defaults().user);assert.equal(Object.hasOwn(loaded,'vip'),false);assert.equal(CATALOG.some(([key])=>key.startsWith('private_')),false);
 assert.equal(JSON.parse(DB.sqlite.prepare('SELECT policies_json FROM access_policies').get().policies_json).vip.includes('private_read'),true);
});
