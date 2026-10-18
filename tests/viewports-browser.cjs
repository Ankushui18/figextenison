'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');const http=require('http');
(async()=>{
 const srv=http.createServer((q,r)=>{r.setHeader('content-type','text/html; charset=utf-8');r.end('<html><head><meta name=viewport content="width=device-width"><style>body{margin:0;font:28px sans-serif;color:#fff;padding:20px;height:300px;background:#2255cc}.l:after{content:" DESKTOP"}@media(max-width:900px){body{background:#22aa55}.l:after{content:" TABLET"}}@media(max-width:500px){body{background:#cc3333}.l:after{content:" MOBILE"}}</style></head><body><div class=l>Layout</div></body></html>')}).listen(8765);
 const ext=require('node:path').resolve(process.env.EXTENSION_ROOT||require('node:path').join(__dirname,'..'));
 const ctx=await chromium.launchPersistentContext(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'pc-viewports-')),{channel:'chromium',headless:true,viewport:null,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--headless=new','--no-sandbox','--window-size=1280,800','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1']});
 const reqs=[];ctx.on('request',r=>reqs.push(r.url()));
 let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');
 const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.goto('http://localhost:8765/');await page.waitForTimeout(500);
 const tabId=await sw.evaluate(async()=>{const [t]=await chrome.tabs.query({url:'http://localhost:8765/*'});await chrome.scripting.executeScript({target:{tabId:t.id,frameIds:[0]},files:['js/privacy.js','js/design-system-core.js','js/design-system-board.js','js/design-system.js','js/h2d_toolbar.js'],injectImmediately:true});return t.id});
 await page.waitForTimeout(1500);
 await page.waitForTimeout(500);
 const inner=await page.evaluate(()=>innerWidth);console.log('inner width',inner);
 // locate buttons by scanning x for popover
 let opened=false;for(let x=845;x<895&&!opened;x+=10){await page.mouse.click(x,37);await page.waitForTimeout(250);opened=await page.evaluate(()=>!!document.getElementById('__pc_viewports__'));if(opened)console.log('viewports button hit at x=',x)}
 
 await page.evaluate(()=>{const r=document.getElementById('__pc_viewports__').shadowRoot;for(const row of r.querySelectorAll('.row')){const v=row.querySelector('input[type=number]');if(v&&['768','393'].includes(v.value))row.querySelector('input[type=checkbox]').click()}});
 await page.waitForTimeout(300);
 assert.deepEqual(JSON.parse(JSON.stringify((await sw.evaluate(()=>chrome.storage.local.get('pc_viewports_v1'))).pc_viewports_v1.filter(r=>r.on).map(r=>r.id))),['browser','768','393']);
 console.log('stored:',JSON.stringify((await sw.evaluate(()=>chrome.storage.local.get('pc_viewports_v1'))).pc_viewports_v1.filter(r=>r.on).map(r=>r.id)));
 await page.keyboard.press('Escape');await page.waitForTimeout(200);
 console.log('popover closed by Esc:',await page.evaluate(()=>!document.getElementById('__pc_viewports__')));
 const t0=Date.now();
 // click Capture design (x scan: ~ 360)
 await page.mouse.click(610,37);
 let caps=[];for(let i=0;i<90;i++){await page.waitForTimeout(1000);caps=await sw.evaluate(async(id)=>{const k='figma_h2d_toolbar_captures_'+id;return (await chrome.storage.local.get(k))[k]||[]},tabId);if(caps.length>=3)break}
 console.log('captures:',caps.length,'in',((Date.now()-t0)/1000).toFixed(1)+'s');
 for(const c of caps){const j=JSON.parse(c.h2dJson);const m=JSON.stringify(j).match(/(DESKTOP|TABLET|MOBILE)/);console.log(' root width',j.root&&j.root.rect&&j.root.rect.width,'marker',m&&m[0])}
 await page.waitForTimeout(1500);
 assert.equal(caps.length,3);assert.deepEqual(caps.map(c=>JSON.parse(c.h2dJson).root.rect.width),[1280,768,393]);
 console.log('extra windows left open:',(await sw.evaluate(async()=>(await chrome.windows.getAll()).length)));
 assert.equal((await sw.evaluate(async()=>(await chrome.windows.getAll()).length)),1,'temporary windows closed');assert.deepEqual(errs,[]);
 console.log('page errors:',errs);console.log('non-local requests:',reqs.filter(u=>!/^(data:|http:\/\/localhost|chrome-extension:)/.test(u)));
 await ctx.close();srv.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
