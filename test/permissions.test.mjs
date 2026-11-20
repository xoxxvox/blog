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
  const registered=await auth.onRequestPost({env,request:request('/api/auth',null,'POST',{action:'register',username:'new-'+role,email:role+'@test.example',password:'test-pass-123',inviteCode:code})});assert.equal(registered.status,201,await registered.clone().text());assert.equal((await registered.json()).user.role,role);
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
 const responses=await Promise.all(['one','two'].map(suffix=>auth.onRequestPost({env,request:request('/api/auth',null,'POST',{action:'register',username:'race-'+suffix,email:suffix+'@test.example',password:'test-pass-123',inviteCode:'ONE-USE'})})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
 assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE username LIKE 'race-%'").get().count,1);
});

test("invite list includes the bound username and current email",async()=>{
 const {env,cookies}=await setup();
 await invite.onRequestPost({env,request:request('/api/invites',cookies.admin,'POST',{code:'BOUND-CODE',role:'vip',durationDays:30})});
 const registered=await auth.onRequestPost({env,request:request('/api/auth',null,'POST',{action:'register',username:'bound-person',email:'bound@test.example',password:'test-pass-123',inviteCode:'BOUND-CODE'})});assert.equal(registered.status,201);
 const response=await invite.onRequestGet({env,request:request('/api/invites',cookies.admin)}),data=await response.json(),row=data.invites.find(item=>item.code==='BOUND-CODE');assert.equal(row.bound_username,'bound-person');assert.equal(row.bound_email,'bound@test.example');
});
