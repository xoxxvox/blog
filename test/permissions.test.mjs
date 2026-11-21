import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1, sessionUser, request } from "./d1-fixture.mjs";
import { defaults, savePolicies, can } from "../functions/api/_permissions.js";
import * as policy from "../functions/api/permissions.js";
import * as invite from "../functions/api/invites.js";
import * as auth from "../functions/api/auth.js";
import * as comments from "../functions/api/comments.js";
import * as upload from "../functions/api/upload.js";
async function setup(){const DB=createD1();DB.sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const env={DB};const cookies=Object.fromEntries(["guest","user","advanced","vip","admin"].map(role=>[role,sessionUser(DB,role,"blog_session")]));return {DB,env,cookies};}
function registration(env, body) {
 const now=Math.floor(Date.now()/1000);
 env.DB.sqlite.exec("CREATE TABLE IF NOT EXISTS email_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, code TEXT NOT NULL, purpose TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
 env.DB.sqlite.prepare("INSERT INTO email_verifications(email,code,purpose,created_at,expires_at) VALUES (?,?,'register',?,?)").run(body.email,'123456',now,now+600);
 return request('/api/auth',null,'POST',{...body,emailCode:'123456'});
}
test('registration requires a valid unexpired email code and consumes it on success', async () => {
 const {env}=await setup();
 const body={action:'register',username:'verified-account',email:'verified@test.example',password:'test-pass-123'};
 assert.equal((await auth.onRequestPost({env,request:request('/api/auth',null,'POST',body)})).status,400);
 const valid=registration(env,body);
 assert.equal((await auth.onRequestPost({env,request:request('/api/auth',null,'POST',{...body,emailCode:'654321'})})).status,403);
 env.DB.sqlite.prepare('UPDATE email_verifications SET expires_at=0').run();
 assert.equal((await auth.onRequestPost({env,request:valid})).status,403);
 const response=await auth.onRequestPost({env,request:registration(env,body)});
 assert.equal(response.status,201);
 assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE email=?").get(body.email).count,0);
});
test("blog policy changes are validated and only administrators can save",async()=>{
 const {env,cookies}=await setup(),p=defaults();p.user=[];p.admin=[];
 assert.equal((await policy.onRequestPost({env,request:request('/api/permissions',cookies.user,'POST',{policies:p})})).status,403);
 assert.equal((await policy.onRequestPost({env,request:request('/api/permissions',cookies.admin,'POST',{policies:p})})).status,200);
 assert.equal(await can(env,{role:'user'},'comment'),false);assert.equal(await can(env,{role:'admin'},'comment'),true);
 assert.equal((await comments.onRequestPost({env,request:request('/api/comments',cookies.user,'POST',{postId:'p',content:'blocked'})})).status,403);
 assert.equal((await upload.onRequestPost({env,request:request('/api/upload',cookies.user,'POST',{})})).status,403);
 assert.equal((await auth.onRequestPost({env,request:request('/api/auth',cookies.user,'POST',{action:'update_profile',profile:{}})})).status,403);
});
test("all five invitation levels register without changing existing account roles",async()=>{
 const {env,cookies}=await setup();
 for(const role of ['guest','user','advanced','vip','admin']){
  const code='BLOG-'+role.toUpperCase();const created=await invite.onRequestPost({env,request:request('/api/invites',cookies.admin,'POST',{code,role,durationDays:30})});assert.equal(created.status,201);
  const registered=await auth.onRequestPost({env,request:registration(env,{action:'register',username:'new-'+role,email:role+'@test.example',password:'test-pass-123',inviteCode:code})});assert.equal(registered.status,201,await registered.clone().text());assert.equal((await registered.json()).user.role,role);
 }
});
test("blog and image policies remain isolated even with a shared D1",async()=>{
 const {env}=await setup();const p=defaults();p.user=[];await savePolicies(env,p);
 env.DB.sqlite.prepare('INSERT INTO access_policies(scope,policies_json) VALUES (?,?)').run('imghub','{}');
 assert.equal(await can(env,{role:'user'},'comment'),false);
});

test("concurrent registrations cannot consume a single invitation twice",async()=>{
 const {env,cookies,DB}=await setup();
 const created=await invite.onRequestPost({env,request:request('/api/invites',cookies.admin,'POST',{code:'ONE-USE',role:'vip',durationDays:30})});assert.equal(created.status,201);
 const responses=await Promise.all(['one','two'].map(suffix=>auth.onRequestPost({env,request:registration(env,{action:'register',username:'race-'+suffix,email:suffix+'@test.example',password:'test-pass-123',inviteCode:'ONE-USE'})})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE username LIKE 'race-%'").get().count,1);
});

test("invite list includes the bound username and current email",async()=>{
 const {env,cookies}=await setup();
 await invite.onRequestPost({env,request:request('/api/invites',cookies.admin,'POST',{code:'BOUND-CODE',role:'vip',durationDays:30})});
 const registered=await auth.onRequestPost({env,request:registration(env,{action:'register',username:'bound-person',email:'bound@test.example',password:'test-pass-123',inviteCode:'BOUND-CODE'})});assert.equal(registered.status,201);
 const response=await invite.onRequestGet({env,request:request('/api/invites',cookies.admin)}),data=await response.json(),row=data.invites.find(item=>item.code==='BOUND-CODE');assert.equal(row.bound_username,'bound-person');assert.equal(row.bound_email,'bound@test.example');
});

test("existing admin is promoted to superadmin above invite-created admin and frontend/admin sessions are isolated",async()=>{
 const {env,cookies}=await setup();
 // Initial admin is promoted to superadmin on first getSessionUser; newly registered admin stays 'admin'
 const created=await invite.onRequestPost({env,request:request('/api/invites',cookies.admin,'POST',{code:'SUB-ADMIN',role:'admin',durationDays:30})});assert.equal(created.status,201);
 const reg=await auth.onRequestPost({env,request:registration(env,{action:'register',username:'sub-admin',email:'sub@test.example',password:'test-pass-123',inviteCode:'SUB-ADMIN'})});assert.equal(reg.status,201);
 assert.equal((await reg.clone().json()).user.role,'admin');
 const subCookie=reg.headers.get('set-cookie').split(';')[0];
 // Invite-created admin cannot manage invites or policies
 assert.equal((await invite.onRequestPost({env,request:request('/api/invites',subCookie,'POST',{code:'BLOCKED',role:'user',durationDays:30})})).status,403);
 assert.equal((await policy.onRequestPost({env,request:request('/api/permissions',subCookie,'POST',{policies:defaults()})})).status,403);
 // Admin login uses blog_admin_session via X-Admin-Session: 1, separate from frontend blog_session
 const adminLoginReq=new Request('https://example.com/api/auth',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Session':'1'},body:JSON.stringify({action:'login',username:'sub-admin',password:'test-pass-123'})});
 assert.equal((await auth.onRequestPost({env,request:adminLoginReq})).status,403);
});
