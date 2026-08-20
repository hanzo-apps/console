import { chromium } from 'playwright'
const OUT='/dev/shm/gotmp/claude-1000/-home-z-work-lux/0186cab5-b488-4e0a-9f8d-af753b5eb08d/scratchpad/shots'
const H='https://console.hanzo.ai'
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const claims={owner:'hanzo',name:'z',email:'z@hanzo.ai',displayName:'Z Admin',isAdmin:true}
const iat=Math.floor(Date.now()/1000)
const token=`${b64({alg:'none'})}.${b64({...claims,sub:'hanzo/z',iat,exp:iat+86400})}.x`
const PROJECTS=[{id:'p1',org:'hanzo',slug:'web',name:'Web',applications:2,createdAt:1700000000000}]
const APPS=[{id:'a1',org:'hanzo',projectId:'p1',slug:'api',name:'api',source:'git',repo:{url:'https://git.hanzo.ai/hanzoai/api.git',branch:'main'},domains:['api.hanzo.app'],status:'live',phase:'Running',createdAt:1754000000000,updatedAt:1754350000000}]
const SITES=[{id:'s1',org:'hanzo',slug:'docs',name:'docs',repo:{url:'https://git.hanzo.ai/hanzoai/docs.git'},framework:'next',status:'live',liveUrl:'https://docs.hanzo.app',createdAt:1754000000000,updatedAt:1754350000000}]
const CD={applications:[
 {name:'api',namespace:'tenant-hanzo',image:{repository:'ghcr.io/hanzoai/api',tag:'v1.4.2'},phase:'Running',health:'Healthy',sync:'Synced',replicas:2,readyReplicas:2,liveTag:'v1.4.2'},
 {name:'worker',namespace:'tenant-hanzo',image:{repository:'ghcr.io/hanzoai/worker',tag:'v0.9.1'},phase:'Progressing',health:'Progressing',sync:'OutOfSync',replicas:1,readyReplicas:0,liveTag:'v0.9.0'}]}
const BUILDS={builds:[{id:'b1',repo:'hanzoai/api',commit:'9f2c1ab77d10',tag:'v1.4.2',status:'succeeded',startedAt:'2026-08-05T18:04:00Z',duration:'2m14s'}]}
const BUCKETS={buckets:[{name:'docs-site',createdAt:1754000000},{name:'media',createdAt:1750000000}]}
const b=await chromium.launch()
const ctx=await b.newContext({viewport:{width:1512,height:950}})
await ctx.addInitScript(({org,token})=>{try{
 localStorage.setItem('hanzo_iam_access_token',token)
 localStorage.setItem('hanzo_iam_expires_at',String(Date.now()+3600_000))
 localStorage.setItem('hanzo.console.org',org)
 localStorage.setItem('hanzo.console.org.selected','1')
 localStorage.setItem(`hz_onboarding_done:${org}`,'1')
 localStorage.setItem(`hz_tour_seen:v1:${org}`,'1')
 localStorage.setItem('hz_admin_banner_dismissed','1')}catch{}},{org:'hanzo',token})
const p=await ctx.newPage()
const viol=[],mime=[]
p.on('console',m=>{const t=m.text()
 if(/Content Security Policy|violates/i.test(t))viol.push(t.slice(0,90))
 if(/not executable/i.test(t))mime.push(t.slice(0,90))})
const json=(r,x)=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)})
await p.route('**/v1/**',r=>{const path=new URL(r.request().url()).pathname
 if(path.endsWith('/v1/platform/projects'))return json(r,PROJECTS)
 if(path.includes('/v1/platform/projects/')&&path.endsWith('/apps'))return json(r,APPS)
 if(path.endsWith('/v1/platform/sites'))return json(r,SITES)
 if(path.endsWith('/v1/deploy/applications'))return json(r,CD)
 if(path.endsWith('/v1/builds'))return json(r,BUILDS)
 if(path.endsWith('/v1/s3/buckets'))return json(r,BUCKETS)
 return json(r,{})})
await p.route('**/userinfo*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...claims,sub:'hanzo/z'})}))
await p.route('**/.well-known/**',r=>r.fulfill({status:404,body:''}))
for(const [path,tag] of [['/deploy','LIVE-deploy-apps'],['/deploy/cd','LIVE-deploy-cd'],['/deploy/storage','LIVE-deploy-storage']]){
 await p.goto(H+path,{waitUntil:'load',timeout:60000}).catch(e=>console.log('goto',e.message))
 await p.waitForTimeout(7000)
 const txt=(await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,' ')
 console.log(`\n[${tag}] chars=${txt.length} csp=${viol.length} mime=${mime.length}`)
 console.log('  ',txt.slice(txt.indexOf('Deploy')>=0?txt.indexOf('Deploy'):0,txt.indexOf('Deploy')+260))
 await p.screenshot({path:`${OUT}/${tag}.png`})
}
const navs=[]
for(const n of ['Deploy','Apps','Sites','Domains','CD','CI','Storage']) if(await p.getByText(n,{exact:true}).count().catch(()=>0)) navs.push(n)
console.log('\nDEPLOY NAV ON LIVE:',navs.join(', '))
console.log('TOTAL csp violations:',viol.length,' mime errors:',mime.length)
await b.close()
