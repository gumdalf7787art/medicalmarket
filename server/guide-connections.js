import {bodyJson,failure,json,requireAdmin,safeHandler,sameOrigin} from './cloud.js';

const hashPattern=/^[a-f0-9]{64}$/;
function connections(scope){
  const table=scope==='product'?'mm_product_connections':'mm_guide_connections';
  const tokenPattern=new RegExp('^Bearer (mm_'+scope+'_[a-f0-9]{64})$');
  const schema=`CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, client TEXT NOT NULL,
    source_hash TEXT NOT NULL, requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    approved_at INTEGER, revoked_at INTEGER
  )`;

  async function digest(value){
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  async function findConnection(request,db){
    const match=tokenPattern.exec(request.headers.get('Authorization')||'');
    if(!match)return null;
    return db.prepare(`SELECT id,expires_at,approved_at,revoked_at FROM ${table} WHERE token_hash=?`).bind(await digest(match[1])).first();
  }

  async function approved(request,db){
    if(!tokenPattern.test(request.headers.get('Authorization')||''))return false;
    await db.prepare(schema).run();
    const row=await findConnection(request,db);
    return row?.approved_at&&!row.revoked_at?row.id:null;
  }

  const requestConnection=safeHandler(async({request,env})=>{
    const {token_hash,client}=await bodyJson(request,2048)||{};
    if(typeof token_hash!=='string'||!hashPattern.test(token_hash)||typeof client!=='string'||!client.trim()||client.length>80){
      throw failure('연결 요청 정보를 확인해 주세요.');
    }
    const db=env.DB,now=Date.now(),id=crypto.randomUUID(),expires=now+30*60*1000;
    const source=await digest(request.headers.get('CF-Connecting-IP')||'unknown');
    await db.prepare(schema).run();
    await db.prepare(`DELETE FROM ${table} WHERE approved_at IS NULL AND requested_at <= ?`).bind(now-3600000).run();
    const insert=await db.prepare(`INSERT INTO ${table}(id,token_hash,client,source_hash,requested_at,expires_at)
      SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM ${table} WHERE source_hash=? AND requested_at>?) < 5
      AND (SELECT count(*) FROM ${table} WHERE approved_at IS NULL AND expires_at>?) < 100
      ON CONFLICT(token_hash) DO UPDATE SET id=excluded.id,client=excluded.client,source_hash=excluded.source_hash,
        requested_at=excluded.requested_at,expires_at=excluded.expires_at
      WHERE approved_at IS NULL AND revoked_at IS NULL AND expires_at<=?`)
      .bind(id,token_hash,client.trim(),source,now,expires,source,now-3600000,now,now).run();
    const row=await db.prepare(`SELECT id,expires_at,approved_at,revoked_at FROM ${table} WHERE token_hash=?`).bind(token_hash).first();
    if(row?.revoked_at)throw failure('해제된 연결입니다. 새 연결을 요청해 주세요.',409);
    if(!row||(!row.approved_at&&row.expires_at<=now))throw failure('연결 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
    return json({id:row.id,expires_at:row.expires_at},insert.meta.changes?201:200);
  });

  const connectionStatus=safeHandler(async({request,env})=>{
    const db=env.DB;
    await db.prepare(schema).run();
    const row=await findConnection(request,db);
    const state=!row?'unknown':row.revoked_at?'revoked':row.approved_at?'active':row.expires_at<=Date.now()?'expired':'pending';
    return json({state,connected:state==='active',id:row?.id||null});
  });

  const listConnections=safeHandler(async({request,env})=>{
    await requireAdmin(request,env);
    const db=env.DB;
    await db.prepare(schema).run();
    const result=await db.prepare(`SELECT id,client,requested_at,expires_at,approved_at
      FROM ${table} WHERE revoked_at IS NULL AND (approved_at IS NOT NULL OR expires_at>?)
      ORDER BY requested_at DESC LIMIT 100`).bind(Date.now()).all();
    return json({connections:result.results});
  });

  const manageConnection=safeHandler(async({request,env})=>{
    sameOrigin(request);
    await requireAdmin(request,env);
    const {id,action}=await bodyJson(request,2048)||{};
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||!['approve','revoke'].includes(action))throw failure('연결 ID와 작업을 확인해 주세요.');
    const db=env.DB,now=Date.now();
    await db.prepare(schema).run();
    const result=action==='approve'
      ?await db.prepare(`UPDATE ${table} SET approved_at=? WHERE id=? AND revoked_at IS NULL AND approved_at IS NULL AND expires_at>?`).bind(now,id,now).run()
      :await db.prepare(`UPDATE ${table} SET revoked_at=? WHERE id=? AND revoked_at IS NULL`).bind(now,id).run();
    if(!result.meta.changes)throw failure('연결 요청이 만료되었거나 이미 처리되었습니다.',409);
    return json({state:action==='approve'?'active':'revoked'});
  });

  return {approved,requestConnection,connectionStatus,listConnections,manageConnection};
}
export const {approved:isApprovedGuideConnection,requestConnection,connectionStatus,listConnections,manageConnection}=connections("guide");
export const productConnections=connections("product");
