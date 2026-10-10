const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.WALLZ_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'..');
const extension=path.join(root,'extension');
const evidence=path.join(root,'work','browser-evidence');
fs.mkdirSync(evidence,{recursive:true});
const readSnapshot=async page=>page.evaluate(()=>new Promise(resolve=>{
  const receive=e=>{if(e.data?.channel==='wallz-adviser-position-v1'){window.removeEventListener('message',receive);resolve(e.data.data);}};
  window.addEventListener('message',receive);
  setTimeout(()=>{window.removeEventListener('message',receive);resolve(null);},2500);
}));
const assertions=[];
let context,opponentContext,page;
(async()=>{
  const profile=fs.mkdtempSync(path.join(root,'work','smoke-profile-'));
  context=await chromium.launchPersistentContext(profile,{
    headless:true,channel:'chromium',executablePath:process.env.WALLZ_BROWSER_EXECUTABLE || chromium.executablePath(),ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
  });
  context.setDefaultTimeout(20000);
  await context.route('**/*',route=>{
    const hostname=new URL(route.request().url()).hostname;
    if(hostname==='wallz.gg' || hostname.endsWith('.wallz.gg') || hostname.endsWith('.r2.dev')) return route.continue();
    return route.abort();
  });
  page=await context.newPage();
  let worker=context.serviceWorkers()[0];
  if(!worker) worker=await context.waitForEvent('serviceworker',{timeout:15000});
  console.log('Extension service worker loaded.');
  assertions.push('Manifest V3 service worker loaded');
  await page.goto('https://www.wallz.gg/',{waitUntil:'domcontentloaded'});
  await page.locator('#wallz-adviser').waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole('button',{name:'Play Computer',exact:true}).click();
  await page.getByRole('button',{name:'Start',exact:true}).click();
  await page.locator('#wallz-adviser-overlay [data-action]').waitFor({timeout:20000});
  await page.getByText('tap to skip',{exact:false}).click({timeout:3000}).catch(()=>{});
  let snap=await readSnapshot(page);
  assert.equal(snap.mode,'practice');assert.equal(snap.state.turn,'p1');assert.equal(snap.flipped,true);
  const candidates=page.locator('#wallz-adviser-overlay [data-action]');
  assert.equal(await candidates.count(),1);
  assertions.push('Real practice board captured and one next action rendered');
  await page.screenshot({path:path.join(evidence,'practice-desktop.png'),fullPage:true});
  await page.locator('#wallz-adviser').getByRole('button',{name:'Adviser controls',exact:true}).click();
  await page.locator('#wallz-adviser').getByRole('button',{name:'Pause',exact:true}).click();
  await page.locator('#wallz-adviser').getByText('Paused',{exact:true}).waitFor();
  assert.equal(await candidates.count(),0);
  await page.locator('#wallz-adviser').getByRole('button',{name:'Resume',exact:true}).click();
  await page.locator('#wallz-adviser-overlay [data-action]').waitFor();
  assertions.push('Pause clears advice and resume restores it');

  async function pointer(boardPoint) {
    const xy=await page.locator('svg[aria-label="Wallz board"]').evaluate((svg,a)=>{
      const p=svg.createSVGPoint();p.x=a.x;p.y=a.y;const r=p.matrixTransform(svg.getScreenCTM());return {x:r.x,y:r.y};
    },boardPoint);
    await page.mouse.click(xy.x,xy.y);
  }
  await pointer({x:318,y:534});
  await page.waitForFunction(()=>document.querySelector('main')?.innerText.includes('MOVES'));
  await page.locator('#wallz-adviser-overlay [data-action]').waitFor({timeout:20000});
  await page.waitForTimeout(700);
  snap=await readSnapshot(page);
  assert.equal(snap.state.pawns.p1.y,1);
  assertions.push('Pawn movement updates the committed position');
  await pointer({x:462,y:354});
  await page.waitForTimeout(1000);
  snap=await readSnapshot(page);
  assert.ok(snap.state.walls.some(w=>w.x===2&&w.y===3&&w.o==='h'));
  assertions.push('Placed wall, orientation and remaining inventory are captured');
  await page.locator('#wallz-adviser-overlay [data-action]').waitFor({timeout:20000});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(evidence,'practice-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assertions.push('390px layout has no horizontal overflow');
  await page.setViewportSize({width:1280,height:900});
  await page.goto('https://www.wallz.gg/');
  await page.getByRole('button',{name:'Play a Friend',exact:true}).click();
  await page.getByRole('button',{name:'Create room Share the code'}).click();
  await page.getByRole('button',{name:'5+1 Rapid'}).click();
  await page.getByRole('button',{name:'Create room',exact:true}).click();
  const codeButton=page.getByRole('button',{name:/^[A-Z0-9]{6} tap to copy$/i});
  await codeButton.waitFor();
  const code=(await codeButton.innerText()).match(/[A-Z0-9]{6}/)[0];
  opponentContext=await context.browser().newContext();
  const opponent=await opponentContext.newPage();
  await opponent.goto('https://www.wallz.gg/');
  await opponent.getByRole('button',{name:'Play a Friend',exact:true}).click();
  await opponent.getByRole('button',{name:'Join room Have a code?'}).click();
  await opponent.getByPlaceholder('ABCDEF').fill(code);
  await opponent.getByRole('button',{name:'Join room',exact:true}).click();
  await page.locator('#wallz-adviser-overlay [data-action]').waitFor({timeout:20000});
  snap=await readSnapshot(page);assert.equal(snap.mode,'private');
  await page.getByText('tap to skip',{exact:false}).click({timeout:3000}).catch(()=>{});
  assertions.push('Real private room recognised and advice displayed');
  await page.screenshot({path:path.join(evidence,'private-game.png'),fullPage:true});

  await opponent.addScriptTag({path:path.join(extension,'bridge.js')});
  snap=await readSnapshot(opponent);assert.equal(snap.player,'p2');assert.equal(snap.flipped,false);
  assertions.push('Second-player board orientation verified');

  await page.getByRole('button',{name:'Resign',exact:true}).click();
  await page.getByRole('button',{name:'Confirm resign?',exact:true}).click();
  await page.locator('#wallz-adviser').getByRole('button',{name:'Adviser controls',exact:true}).click();
  await page.locator('#wallz-adviser').getByText(/^Game finished\.?$/).waitFor({timeout:15000});
  assert.equal(await candidates.count(),0);
  assertions.push('Ended game clears recommendations');
  const report={status:'PASS',assertions,extensionPath:extension,checkedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(async e=>{
  console.error(e);
  if(page) {console.error(await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});}
  process.exitCode=1;
}).finally(async()=>{await opponentContext?.close();await context?.close();});
