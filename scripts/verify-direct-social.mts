import assert from 'node:assert/strict'
import { FileCredentialStore } from '../server/src/credentials/fileCredentialStore.ts'
import { DirectOAuthService,DIRECT_CHANNELS,directConfig,DirectAccountConnector } from '../server/src/social/direct/directOAuth.ts'
import { mkdtemp,rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const dir=await mkdtemp(path.join(os.tmpdir(),'agentdeck-sns-'))
const credentials=new FileCredentialStore(dir)
const env:NodeJS.ProcessEnv={}
for(const ch of DIRECT_CHANNELS){env[`${ch.toUpperCase()}_CLIENT_ID`]='fixture-id';env[`${ch.toUpperCase()}_CLIENT_SECRET`]='fixture-secret'}
let tokenCalls=0,release:(()=>void)|undefined,gate:Promise<void>|undefined
const network:typeof fetch=async(input,init)=>{
 const url=String(input)
 if(url.includes('/access_token') || url.includes('/oauth2/token') || url==='https://oauth2.googleapis.com/token'){
   tokenCalls++
   if(gate){await gate;gate=undefined}
   if(init?.method==='POST')assert.equal(init.redirect,'error')
   return Response.json({access_token:'secret-fixture-access',refresh_token:'secret-fixture-refresh',expires_in:3600,token_type:'bearer'})
 }
 if(url.includes('/channels?'))return Response.json({items:[{id:'channel-1',snippet:{title:'fixture-channel'}}]})
 if(url.includes('api.x.com'))return Response.json({data:{id:'user-1',username:'fixture-user'}})
 return Response.json({id:'user-1',user_id:'user-1',name:'fixture-user',username:'fixture-user'})
}
const service=new DirectOAuthService(credentials,network,env)
try{
 for(const channel of DIRECT_CHANNELS){
  const started=await service.start(channel,'http://localhost:5173')
  const url=new URL(started.authorizeUrl),state=url.searchParams.get('state')!
  assert.equal(url.searchParams.get('client_secret'),null)
  assert.ok(!started.authorizeUrl.includes('fixture-secret'))
  if(['x','youtube'].includes(channel))assert.equal(url.searchParams.get('code_challenge_method'),'S256')
  await assert.rejects(()=>service.callback(channel,{state:'forged',code:'fixture-code'}))
  const result=await service.callback(channel,{state,code:'fixture-code'})
  assert.equal(result.connected,true)
  assert.equal(result.returnOrigin,'http://localhost:5173')
  const saved=await credentials.get(channel,'global');assert.equal(saved?.meta.status,'connected')
  await assert.rejects(()=>service.callback(channel,{state,code:'fixture-code'}))
  const connector=new DirectAccountConnector(channel,credentials)
  assert.deepEqual((await connector.getStateAsync()).capabilities,[])
  assert.ok(!JSON.stringify(await connector.getStateAsync()).includes('secret-fixture'))
  const denied=await service.start(channel);await service.callback(channel,{state:new URL(denied.authorizeUrl).searchParams.get('state')!,error:'access_denied'})
  assert.ok(await credentials.get(channel,'global'),'denial preserves existing connection')
  await service.disconnect(channel);assert.equal(await credentials.get(channel,'global'),null)
  console.log(`PASS ${channel}: config, state, code exchange, profile, replay, secret isolation, denial, disconnect`)
 }
 const one=await service.start('x'),two=await service.start('x')
 await assert.rejects(()=>service.callback('x',{state:new URL(one.authorizeUrl).searchParams.get('state')!,code:'old'}))
 gate=new Promise<void>(r=>release=r)
 const completion=service.callback('x',{state:new URL(two.authorizeUrl).searchParams.get('state')!,code:'new'})
 while(!release)await new Promise(r=>setTimeout(r,1))
 const disconnect=service.disconnect('x');release!();await completion;await disconnect
 assert.equal(await credentials.get('x','global'),null)
 const cloud=new DirectOAuthService(credentials,network,{...env,VERCEL:'1'})
 assert.throws(()=>cloud.start('x'),/로컬/)
 assert.equal(directConfig('x',{...env,VERCEL:'1',X_REDIRECT_URI:'https://example.com/api/social/x/oauth/callback'}).configured,false)
 console.log(`PASS superseded login, serialized callback/disconnect, cloud guard; token exchanges=${tokenCalls}`)
}finally{await rm(dir,{recursive:true,force:true})}
