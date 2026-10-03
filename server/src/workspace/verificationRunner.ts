/** Fixed diagnostic runner. No credential or host environment is embedded. */
export const verificationRunner = String.raw`
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const [root, resultFile, inputFile] = process.argv.slice(2);
let state = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const lock = resultFile + '.lock';
try { fs.mkdirSync(lock); } catch { process.exit(0); }
const save = () => { fs.writeFileSync(resultFile + '.tmp', JSON.stringify(state)); fs.renameSync(resultFile + '.tmp', resultFile); };
const redact = (s) => s.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,'[REDACTED]').replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s]+/gi,'$1[REDACTED]').replace(/(https:\/\/)[^/\s@]+@/gi,'$1[REDACTED]@');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
async function run(cmd,args) {
  const started = Date.now(); let output = ''; return await new Promise((resolve) => {
    const child = cp.spawn(cmd,args,{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
    const append = (buf) => { output = (output + buf.toString()).slice(-6000); };
    child.stdout.on('data',append); child.stderr.on('data',append);
    const timer = setTimeout(() => { try { process.kill(-child.pid,'SIGKILL'); } catch {} }, 300000);
    child.on('error',() => { clearTimeout(timer); resolve({status:'failed',exitCode:127,durationMs:Date.now()-started,logTail:'Command could not be started'}); });
    child.on('close',(code) => { clearTimeout(timer); resolve({status:code===0?'passed':'failed',exitCode:code??124,durationMs:Date.now()-started,logTail:redact(output).slice(-2000)}); });
  });
}
(async () => {
  save();
  let pkg; try { pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')); } catch (error) {
    if(error.code!=='ENOENT') { state.install={status:'failed',reason:'Invalid package.json'};for(const key of ['typecheck','build','test'])state[key]={status:'skipped',reason:'Package validation failed'};state.status='failed';state.completedAt=new Date().toISOString();save();return; }
    for (const key of ['install','typecheck','build','test']) state[key]={status:'skipped',reason:'Node package.json is absent or invalid'};
    state.status='passed'; state.completedAt=new Date().toISOString(); save(); return;
  }
  let cmd='npm',prefix=[], install=['install'];
  if (fs.existsSync(path.join(root,'pnpm-lock.yaml'))) { cmd='corepack'; prefix=['pnpm']; install=['install','--frozen-lockfile']; }
  else if (fs.existsSync(path.join(root,'yarn.lock'))) { cmd='corepack';prefix=['yarn']; install=['install',/^yarn@1\./.test(pkg.packageManager??'')?'--frozen-lockfile':'--immutable']; }
  else if (fs.existsSync(path.join(root,'package-lock.json')) || fs.existsSync(path.join(root,'npm-shrinkwrap.json'))) install=['ci'];
  else { state.install={status:'skipped',reason:'A supported lockfile is required for reproducible installation'}; }
  for (const key of ['install','typecheck','build','test']) {
    if (key==='install' && state.install.status==='skipped') { save(); continue; }
    if (key!=='install' && typeof pkg.scripts?.[key]!=='string') { state[key]={status:'skipped',reason:'No '+key+' script'}; save(); continue; }
    state[key]={status:'running'};save();
    state[key]=await run(cmd,prefix.concat(key==='install'?install:['run',key])); save();
    if(state[key].status==='failed') { for(const next of ['install','typecheck','build','test']) if(state[next].status==='pending')state[next]={status:'skipped',reason:'An earlier step failed'};state.status='failed';state.completedAt=new Date().toISOString();save();return; }
  }
  state.status='passed'; state.completedAt=new Date().toISOString();save();
})().catch(() => {state.status='failed';state.completedAt=new Date().toISOString();save();process.exitCode=1;});
`;
