import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1,sessionUser,request } from './d1-fixture.mjs';
import * as posts from '../functions/api/private-posts.js';
import * as categories from '../functions/api/private-post-categories.js';
import * as content from '../functions/api/content.js';
import { defaults,savePolicies } from '../functions/api/_permissions.js';
async function setup(){const DB=createD1();DB.sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));const env={DB};const cookies=Object.fromEntries(['guest','user','advanced','vip','admin'].map(role=>[role,sessionUser(DB,role,'blog_session')]));return {DB,env,cookies};}
const sample={id:'private-one',title:'仅限 VIP 的手记',excerpt:'私密摘要',body:'# 私密正文\n\nPRIVATE-SENTINEL',category:'未分类',date:'2026-11-20'};
test('private articles are absent from public content and require VIP for list, body and export',async()=>{
 const {env,cookies}=await setup();assert.equal((await posts.onRequestPost({env,request:request('/api/private-posts',cookies.admin,'POST',sample)})).status,200);
 for(const role of [null,'guest','user','advanced']) for(const path of ['/api/private-posts','/api/private-posts?id=private-one','/api/private-posts?id=private-one&download=1'])assert.equal((await posts.onRequestGet({env,request:request(path,cookies[role])})).status,403);
 const list=await (await posts.onRequestGet({env,request:request('/api/private-posts',cookies.vip)})).json();assert.equal(list.posts.length,1);assert.equal(list.posts[0].body,undefined);
 const detail=await posts.onRequestGet({env,request:request('/api/private-posts?id=private-one',cookies.vip)});assert.equal(detail.headers.get('Cache-Control'),'private, no-store');assert.equal((await detail.json()).post.body,sample.body);
 const exported=await posts.onRequestGet({env,request:request('/api/private-posts?id=private-one&download=1',cookies.vip)});assert.match(exported.headers.get('Content-Disposition'),/^attachment/);assert((await exported.text()).includes('PRIVATE-SENTINEL'));
 const publicSnapshot=await content.onRequestGet({env,request:request('/api/content')});assert(!(await publicSnapshot.text()).includes('PRIVATE-SENTINEL'));
 assert.equal((await posts.onRequestPost({env,request:request('/api/private-posts',cookies.vip,'POST',sample)})).status,403);
 const p=defaults();p.vip=p.vip.filter(key=>key!=='private_export');await savePolicies(env,p);assert.equal((await posts.onRequestGet({env,request:request('/api/private-posts?id=private-one&download=1',cookies.vip)})).status,403);
});
test('private article category rename/delete preserves articles and cannot be performed by VIP',async()=>{
 const {DB,env,cookies}=await setup();const change=(body,role='admin')=>categories.onRequestPost({env,request:request('/api/private-post-categories',cookies[role],'POST',body)});
 assert.equal((await change({action:'create',name:'独立分类'},'vip')).status,403);assert.equal((await change({action:'create',name:'独立分类'})).status,200);
 assert.equal((await posts.onRequestPost({env,request:request('/api/private-posts',cookies.admin,'POST',{...sample,category:'独立分类'})})).status,200);
 await change({action:'rename',name:'独立分类',nextName:'新分类'});assert.equal(DB.sqlite.prepare('SELECT category FROM private_posts').get().category,'新分类');
 await change({action:'delete',name:'新分类'});assert.equal(DB.sqlite.prepare('SELECT category FROM private_posts').get().category,'未分类');assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM private_posts').get().n,1);
 assert.equal((await change({action:'delete',name:'未分类'})).status,400);
 assert.equal((await change({action:'create',name:'备用分类'})).status,200);
 assert.equal((await change({action:'rename',name:'未分类',nextName:'默认归档'})).status,200);
 assert.equal(DB.sqlite.prepare('SELECT category FROM private_posts').get().category,'默认归档');
 assert.equal((await change({action:'delete',name:'默认归档'})).status,200);
 assert.equal(DB.sqlite.prepare('SELECT category FROM private_posts').get().category,'备用分类');
});

test('private-space intro is separately stored and is not exposed through public profile data',async()=>{
 const {env,cookies}=await setup();const bio=await import('../functions/api/private-bio.js');
 const body={bio:{enabled:true,profileName:'PRIVATE-BIO-NAME',avatar:'/api/image?key=avatar',profilePhoto:'',profilePhotoEnabled:true,tags:['私密标签'],info:{name:'独立姓名',gender:'保密',age:'27',labels:{name:'昵称'},extraInfo:[{label:'兴趣',value:'阅读'}]}}};
 assert.equal((await bio.onRequestPost({env,request:request('/api/private-bio',cookies.vip,'POST',body)})).status,403);
 assert.equal((await bio.onRequestPost({env,request:request('/api/private-bio',cookies.admin,'POST',body)})).status,200);
 for(const role of [null,'guest','user','advanced'])assert.equal((await bio.onRequestGet({env,request:request('/api/private-bio',cookies[role])})).status,403);
 const response=await bio.onRequestGet({env,request:request('/api/private-bio',cookies.vip)});assert.equal(response.headers.get('Cache-Control'),'private, no-store');const data=await response.json();assert.equal(data.bio.profileName,'PRIVATE-BIO-NAME');assert.equal(data.bio.profilePhoto,'');assert.equal(data.bio.info.labels.name,'昵称');
 assert(!(await (await content.onRequestGet({env,request:request('/api/content')})).text()).includes('PRIVATE-BIO-NAME'));
});

test('private article categories stop at eight including uncategorized',async()=>{
 const {env,cookies}=await setup();const create=name=>categories.onRequestPost({env,request:request('/api/private-post-categories',cookies.admin,'POST',{action:'create',name})});
 for(let i=1;i<=7;i++)assert.equal((await create('独立分类'+i)).status,200);
 assert.equal((await create('第九个分类')).status,400);const list=await (await categories.onRequestGet({env,request:request('/api/private-post-categories',cookies.admin)})).json();assert.equal(list.categories.length,8);
});
