import {json} from '../../../server/cloud.js';
export async function onRequestGet({env}) {
  const checks={DB:false,MEDIA:false,PRIVATE_FILES:false};
  await Promise.all(Object.keys(checks).map(async key=>{try{if(!env[key])return;if(key==='DB')await env.DB.prepare('SELECT 1 AS ok').first();else await env[key].head('_connection-checks/status');checks[key]=true;}catch{}}));
  return json({cloud:true,checks,ok:Object.values(checks).every(Boolean)});
}
