const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
const R=path.resolve(__dirname,'..'),scenarios=JSON.parse(fs.readFileSync(path.join(R,'web/scenarios.json')));
const RUN_ROOT=process.env.BENCH_SUBMISSIONS||path.join(R,'runs');
const OUT_ROOT=process.env.BENCH_EVAL_OUTPUT||path.join(R,'evidence/evaluation');fs.mkdirSync(OUT_ROOT,{recursive:true});
async function capture(page){return page.evaluate(()=>{fluid.render();const c=document.querySelector('canvas');const gl=c.getContext('webgl2')||c.getContext('webgl');let p;if(gl){p=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,p);}else{p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;}let s='';for(let i=0;i<p.length;i+=32768)s+=String.fromCharCode(...p.subarray(i,i+32768));return {data:btoa(s),w:c.width,h:c.height,error:gl?gl.getError():null};});}
(async()=>{const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {}),headless:true,args:['--allow-file-access-from-files']});let all=[];
for(const model of process.argv.slice(2).length?process.argv.slice(2):['reference','k3','grok-4.7','gpt-6.1-sol']){
 const input=model.startsWith('reference')?path.join(R,'web/reference.html'):path.join(RUN_ROOT,model,'index.html');
 if(!fs.existsSync(input)){all.push({model,status:'missing'});continue;}
 for(const [name,scenario] of Object.entries(scenarios)){
  const out=path.join(OUT_ROOT,model,name);fs.mkdirSync(out,{recursive:true});const page=await browser.newPage({viewport:{width:640,height:400},deviceScaleFactor:1});let errors=[];page.on('pageerror',e=>errors.push(String(e)));let report={model,scenario:name,errors,snapshots:[]};
  try{await page.goto('file://'+input);report.environment=await page.evaluate(()=>{const c=document.querySelector('canvas'),g=c.getContext('webgl2')||c.getContext('webgl');let es=[];if(g){let e;while((e=g.getError())&&es.length<16)es.push(e)}return {webgl:!!g,startupErrors:es,renderer:g?g.getParameter(g.RENDERER):'2D',width:c.width,height:c.height}});await page.evaluate(config=>{fluid.reset();fluid.setConfig(config);fluid.render();},scenario.config);
   let start=await capture(page);fs.writeFileSync(path.join(out,'initial.rgba'),Buffer.from(start.data,'base64'));report.initialError=start.error;
   for(let frame=0;frame<scenario.frames;frame++){
    await page.evaluate(({events,dt})=>{for(const e of events)fluid.splat(...e);fluid.step(dt);fluid.render();},{events:scenario.events[frame],dt:scenario.dt});
    if(scenario.snapshots.includes(frame)){const p=await capture(page);const label=String(frame+1).padStart(3,'0');fs.writeFileSync(path.join(out,label+'.rgba'),Buffer.from(p.data,'base64'));await page.screenshot({path:path.join(out,label+'.png')});report.snapshots.push({frame:frame+1,error:p.error,width:p.w,height:p.h});}
   }
   await page.evaluate(()=>{fluid.reset();fluid.render();});let reset=await capture(page);fs.writeFileSync(path.join(out,'reset.rgba'),Buffer.from(reset.data,'base64'));report.resetError=reset.error;report.status=errors.length?'runtime_errors':'rendered';
  }catch(e){report.status='error';errors.push(String(e));}
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));all.push(report);await page.close();
 }
}
await browser.close();fs.writeFileSync(path.join(OUT_ROOT,'results-'+process.argv.slice(2).join('_')+'.json'),JSON.stringify(all,null,2));})().catch(e=>{console.error(e);process.exit(1)});
