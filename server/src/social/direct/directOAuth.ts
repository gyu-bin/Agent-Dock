import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { CredentialRepository, StoredCredential } from '../../credentials/types.js'
import type { ConnectorState, SocialChannel, SocialConnector, PublishRequest, PublishResult } from '../types.js'

export const DIRECT_CHANNELS = ['instagram', 'x', 'youtube', 'reddit'] as const
export type DirectChannel = typeof DIRECT_CHANNELS[number]
export function isDirectChannel(value: string): value is DirectChannel { return DIRECT_CHANNELS.includes(value as DirectChannel) }
const LABELS = {instagram:'Instagram',x:'X',youtube:'YouTube',reddit:'Reddit'}
const ENDPOINTS = {
  instagram:{authorize:'https://www.instagram.com/oauth/authorize',token:'https://api.instagram.com/oauth/access_token',profile:'https://graph.instagram.com/me?fields=user_id,username',scope:'instagram_business_basic'},
  x:{authorize:'https://x.com/i/oauth2/authorize',token:'https://api.x.com/2/oauth2/token',profile:'https://api.x.com/2/users/me',scope:'tweet.read users.read offline.access'},
  youtube:{authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',profile:'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',scope:'https://www.googleapis.com/auth/youtube.readonly'},
  reddit:{authorize:'https://www.reddit.com/api/v1/authorize',token:'https://www.reddit.com/api/v1/access_token',profile:'https://oauth.reddit.com/api/v1/me',scope:'identity'},
}
export function directConfig(channel: DirectChannel, env = process.env) {
  const prefix = channel.toUpperCase(), clientId = env[`${prefix}_CLIENT_ID`]?.trim() ?? '', clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim() ?? ''
  const cloud = Boolean(env.VERCEL || env.AGENT_DECK_CLOUD === '1')
  const redirectUri = env[`${prefix}_REDIRECT_URI`]?.trim() || (!cloud ? `http://127.0.0.1:${env.PORT || '8787'}/api/social/${channel}/oauth/callback` : '')
  let safeRedirect = false
  try { const u = new URL(redirectUri); safeRedirect = !u.username && !u.password && !u.search && !u.hash && (u.protocol === 'https:' || !cloud && u.protocol === 'http:' && ['127.0.0.1','localhost'].includes(u.hostname)) && u.pathname === `/api/social/${channel}/oauth/callback` } catch {}
  return {clientId,clientSecret,redirectUri,configured:Boolean(!cloud && clientId && clientSecret && safeRedirect),required:[`${prefix}_CLIENT_ID`,`${prefix}_CLIENT_SECRET`,`${prefix}_REDIRECT_URI`]}
}
const error = (code:string,message:string,status=400) => Object.assign(new Error(message), {code,status})
const stateKey = (state:string) => `oauth_${createHash('sha256').update(state).digest('hex')}`
export class DirectOAuthService {
  private static queues = new Map<string, Promise<unknown>>()
  private serial<T>(channel:DirectChannel,work:()=>Promise<T>):Promise<T> {
    const prior=DirectOAuthService.queues.get(channel) ?? Promise.resolve()
    const result=prior.catch(()=>undefined).then(work)
    DirectOAuthService.queues.set(channel,result)
    void result.catch(()=>undefined).finally(()=>{if(DirectOAuthService.queues.get(channel)===result)DirectOAuthService.queues.delete(channel)})
    return result
  }
  private requireLocal(){if(this.env.VERCEL || this.env.AGENT_DECK_CLOUD==='1')throw error('SOCIAL_LOCAL_ONLY','직접 SNS 연결은 현재 로컬 Agent Deck에서 사용할 수 있습니다.',409)}
  start(channel:DirectChannel,returnOrigin?:string){this.requireLocal();return this.serial(channel,()=>this.startInternal(channel,returnOrigin))}
  callback(channel:DirectChannel,input:{state?:string;code?:string;error?:string}){this.requireLocal();return this.serial(channel,()=>this.callbackInternal(channel,input))}
  private completing = new Set<string>()
  constructor(private credentials:CredentialRepository, private request:typeof fetch=fetch, private env=process.env) {}
  private async startInternal(channel:DirectChannel, returnOrigin?:string) {
    const cfg=directConfig(channel,this.env)
    if(!cfg.configured) throw error('SOCIAL_APP_CONFIG_REQUIRED',`${LABELS[channel]} 개발자 앱의 Client ID, Secret, Redirect URI를 설정해주세요.`,503)
    const origin=new URL(returnOrigin || this.env.AGENT_DECK_CLIENT_ORIGIN || 'http://127.0.0.1:5173').origin
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),now=new Date().toISOString()
    for(const meta of await this.credentials.listMeta(channel)) if(meta.accountKey.startsWith('oauth_')) await this.credentials.delete(channel,meta.accountKey)
    await this.credentials.save({meta:{provider:channel,accountKey:stateKey(state),status:'disconnected',updatedAt:now},secret:{accessToken:state,refreshToken:verifier,expiresAt:new Date(Date.now()+600000).toISOString(),oauth:{clientId:cfg.clientId,redirectUri:cfg.redirectUri,returnOrigin:origin}}})
    const url=new URL(ENDPOINTS[channel].authorize)
    const params={client_id:cfg.clientId,redirect_uri:cfg.redirectUri,response_type:'code',scope:ENDPOINTS[channel].scope,state}
    for(const [key,value] of Object.entries(params)) url.searchParams.set(key,value)
    if(channel==='x' || channel==='youtube'){url.searchParams.set('code_challenge',createHash('sha256').update(verifier).digest('base64url'));url.searchParams.set('code_challenge_method','S256')}
    if(channel==='youtube'){url.searchParams.set('access_type','offline');url.searchParams.set('prompt','consent')}
    if(channel==='reddit')url.searchParams.set('duration','permanent')
    if(channel==='instagram'){url.searchParams.set('enable_fb_login','0');url.searchParams.set('force_authentication','1')}
    return {authorizeUrl:url.toString()}
  }
  private async callbackInternal(channel:DirectChannel,input:{state?:string;code?:string;error?:string}) {
    if(!input.state || input.state.length>200) throw error('SOCIAL_OAUTH_STATE_INVALID','SNS 로그인 요청이 만료되었거나 올바르지 않습니다.')
    const key=stateKey(input.state),lock=`${channel}:${key}`
    if(this.completing.has(lock)) throw error('SOCIAL_OAUTH_STATE_INVALID','이미 처리 중인 로그인 요청입니다.')
    this.completing.add(lock)
    try {
      const pending=await this.credentials.get(channel,key),info=pending?.secret.oauth
      const a=Buffer.from(input.state),b=Buffer.from(pending?.secret.accessToken ?? '')
      if(!pending || !info || a.length!==b.length || !timingSafeEqual(a,b) || Date.parse(pending.secret.expiresAt ?? '')<=Date.now()) throw error('SOCIAL_OAUTH_STATE_INVALID','SNS 로그인 요청이 만료되었거나 올바르지 않습니다.')
      if(input.error || !input.code){await this.credentials.delete(channel,key);return {returnOrigin:info.returnOrigin,connected:false}}
      const cfg=directConfig(channel,this.env)
      if(!cfg.configured || info.clientId!==cfg.clientId || info.redirectUri!==cfg.redirectUri)throw error('SOCIAL_APP_CONFIG_REQUIRED','SNS 앱 설정이 변경되었습니다. 다시 연결해주세요.')
      const body=new URLSearchParams({grant_type:'authorization_code',code:input.code,redirect_uri:info.redirectUri,client_id:cfg.clientId})
      const headers:Record<string,string>={'User-Agent':this.env.REDDIT_USER_AGENT || 'AgentDeck/0.1 (account connection)','Content-Type':'application/x-www-form-urlencoded'}
      if(channel==='x' || channel==='reddit')headers.Authorization=`Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`
      else body.set('client_secret',cfg.clientSecret)
      if(channel==='x' || channel==='youtube')body.set('code_verifier',pending.secret.refreshToken!)
      const tokenBody=channel==='instagram' ? (()=>{const form=new FormData();for(const [k,v] of body)form.set(k,v);delete headers['Content-Type'];return form})() : body
      const raw=await this.json(ENDPOINTS[channel].token,{method:'POST',headers,body:tokenBody})
      let token=channel==='instagram' ? raw.data?.[0] ?? raw : raw
      if(typeof token.access_token!=='string' || !token.access_token)throw error('SOCIAL_OAUTH_EXCHANGE_FAILED','SNS 인증 응답을 확인하지 못했습니다.',502)
      // Instagram's short-lived token is exchanged server-side for its long-lived counterpart.
      if(channel==='instagram') {
        const long=new URL('https://graph.instagram.com/access_token');long.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:cfg.clientSecret,access_token:token.access_token}).toString()
        token={...token,...await this.json(long.toString())}
      }
      const profile=await this.json(ENDPOINTS[channel].profile,{headers:{Authorization:`Bearer ${token.access_token}`,'User-Agent':headers['User-Agent']}})
      const person=channel==='youtube'?profile.items?.[0]:channel==='x'?profile.data:profile
      const id=String(person?.id ?? person?.user_id ?? '')
      if(!id)throw error('SOCIAL_PROFILE_UNAVAILABLE',`${LABELS[channel]} 계정 또는 채널을 확인하지 못했습니다.`,502)
      if(!await this.credentials.get(channel,key))throw error('SOCIAL_OAUTH_CANCELLED','취소된 연결 요청입니다.')
      const now=new Date().toISOString()
      const credential:StoredCredential={meta:{provider:channel,accountKey:'global',profileId:id,username:String(person.username ?? person.name ?? person.snippet?.title ?? id),connectedAt:now,updatedAt:now,status:'connected'},secret:{accessToken:token.access_token,refreshToken:token.refresh_token,tokenType:token.token_type ?? 'bearer',scopes:String(token.scope ?? ENDPOINTS[channel].scope).split(/[ ,]+/),expiresAt:new Date(Date.now()+(Number(token.expires_in)||3600)*1000).toISOString()}}
      await this.credentials.save(credential)
      await this.credentials.delete(channel,key)
      return {returnOrigin:info.returnOrigin,connected:true}
    } catch(e) {await this.credentials.delete(channel,key);throw e} finally {this.completing.delete(lock)}
  }
  private async json(url:string,init:RequestInit={}) {
    let response:Response
    try {response=await this.request(url,{...init,signal:AbortSignal.timeout(20000),redirect:'error'})}catch{throw error('SOCIAL_NETWORK_ERROR','SNS 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',502)}
    const data=await response.json().catch(()=>null)
    if(!response.ok || !data || data.error)throw error('SOCIAL_OAUTH_UPSTREAM','SNS 인증에 실패했습니다. 앱 권한과 등록된 콜백 주소를 확인해주세요.',502)
    return data as Record<string,any>
  }
  disconnect(channel:DirectChannel){this.requireLocal();return this.serial(channel,async()=>{for(const meta of await this.credentials.listMeta(channel))await this.credentials.delete(channel,meta.accountKey)})}
}
/** Account linking only. Publishing capabilities are deliberately not advertised. */
export class DirectAccountConnector implements SocialConnector {
  readonly id:string
  private cached:ConnectorState
  constructor(readonly channel:DirectChannel,private credentials:CredentialRepository){this.id=`${channel}-oauth`;this.cached=this.base()}
  private base():ConnectorState {const cfg=directConfig(this.channel);return{id:this.id,channel:this.channel,label:LABELS[this.channel],state:cfg.configured?'configured':'unconfigured',configured:cfg.configured,available:false,capabilities:[],policy:{requirements:cfg.required,notes:'계정 연결 전용. 게시 권한 및 게시 기능은 별도로 제공됩니다.'},connection:{status:'unconfigured'}}}
  getState(){return this.cached}
  async getStateAsync(){const state=this.base(),credential=await this.credentials.get(this.channel,'global');if(credential){const expired=Date.parse(credential.secret.expiresAt ?? '')<=Date.now();state.connection={status:expired?'expired':'connected',username:credential.meta.username,profileId:credential.meta.profileId};state.available=state.configured&&!expired;state.state=state.available?'available':'degraded'}this.cached=state;return state}
  async validate(_request:PublishRequest){return{ok:false,errors:[{code:'SOCIAL_CAPABILITY_UNSUPPORTED',message:'계정 연결은 지원되지만 이 채널의 직접 게시 기능은 아직 제공되지 않습니다.'}]}}
  async publish(_request:PublishRequest):Promise<PublishResult>{throw error('SOCIAL_CAPABILITY_UNSUPPORTED','이 채널의 직접 게시 기능은 아직 제공되지 않습니다.',409)}
}
