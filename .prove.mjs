import { chromium } from 'playwright'
const OUT='/dev/shm/gotmp/claude-1000/-home-z-work-lux/0186cab5-b488-4e0a-9f8d-af753b5eb08d/scratchpad/shots'
const H='https://console.hanzo.ai'
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
const claims={owner:'hanzo',name:'z',email:'z@hanzo.ai',displayName:'Z Admin',isAdmin:true}
const iat=Math.floor(Date.now()/1000)
const token=`${b64({alg:'none'})}.${b64({...claims,sub:'hanzo/z',iat,exp:iat+86400})}.x`
const browser=await chromium.launch()

// ---------- 1. UNAUTH: PKCE handoff ----------
{
  const p=await (await browser.newContext({viewport:{width:1440,height:900}})).newPage()
  const viol=[],mime=[]
  p.on('console',m=>{const t=m.text()
    if(/Content Security Policy|violates/i.test(t))viol.push(t.slice(0,90))
    if(/not executable/i.test(t))mime.push(t.slice(0,90))})
  await p.goto(H+'/',{waitUntil:'load',timeout:60000}).catch(e=>console.log('goto',e.message))
  await p.waitForTimeout(7000)
  const u=new URL(p.url())
  console.log('=== 1. UNAUTH PKCE ===')
  console.log('  final host   :',u.host)
  console.log('  client_id    :',u.searchParams.get('client_id'))
  console.log('  redirect_uri :',u.searchParams.get('redirect_uri'))
  console.log('  challenge    :',u.searchParams.get('code_challenge_method'))
  console.log('  cspViolations:',viol.length,' mimeErrors:',mime.length)
  await p.screenshot({path:`${OUT}/live-1-pkce.png`})
}

// ---------- 2. LIVE /v1 REACHABILITY (no mocks) ----------
{
  const ctx=await browser.newContext({viewport:{width:1512,height:950}})
  await ctx.addInitScript(({org,token})=>{try{
    localStorage.setItem('hanzo_iam_access_token',token)
    localStorage.setItem('hanzo_iam_expires_at',String(Date.now()+3600_000))
    localStorage.setItem('hanzo.console.org',org)
    localStorage.setItem('hanzo.console.org.selected','1')
    localStorage.setItem(`hz_onboarding_done:${org}`,'1')
    localStorage.setItem(`hz_tour_seen:v1:${org}`,'1')}catch{}},{org:'hanzo',token})
  const p=await ctx.newPage()
  const api=[]
  p.on('response',async r=>{const u=r.url()
    if(u.includes('/v1/')&&u.startsWith(H)) api.push(`${r.status()} ${(r.headers()['content-type']||'').split(';')[0]}  ${u.replace(H,'')}`)})
  const viol=[],mime=[]
  p.on('console',m=>{const t=m.text()
    if(/Content Security Policy|violates/i.test(t))viol.push(t.slice(0,90))
    if(/not executable/i.test(t))mime.push(t.slice(0,90))})
  await p.route('**/userinfo*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...claims,sub:'hanzo/z'})}))
  await p.goto(H+'/deploy',{waitUntil:'load',timeout:60000}).catch(e=>console.log('goto',e.message))
  await p.waitForTimeout(9000)
  const txt=(await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,' ')
  console.log('\n=== 2. LIVE /deploy (real API, forged token) ===')
  console.log('  bodyChars:',txt.length,' cspViolations:',viol.length,' mimeErrors:',mime.length)
  console.log('  text:',txt.slice(0,200))
  console.log('  --- same-origin /v1 responses (unique) ---')
  ;[...new Set(api)].slice(0,12).forEach(a=>console.log('   ',a))
  const html=[...new Set(api)].filter(a=>a.includes('text/html'))
  console.log('  >>> /v1 answered as text/html (SPA index = DEAD ROUTING):',html.length)
  await p.screenshot({path:`${OUT}/live-2-deploy-realapi.png`})
  await ctx.close()
}
await browser.close()
