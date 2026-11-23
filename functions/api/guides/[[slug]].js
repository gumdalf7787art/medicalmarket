import {json,bodyJson,equal,failure,requireAdmin,sameOrigin,safeHandler} from '../../../server/cloud.js';
import {initialize,list,read,save} from '../../../server/guides.js';
import {isApprovedGuideConnection} from '../../../server/guide-connections.js';
async function authorize(request,env,write){
  const token=request.headers.get('Authorization');
  if(token){
    if(env.GUIDE_PUBLISH_TOKEN&&await equal(token,'Bearer '+env.GUIDE_PUBLISH_TOKEN))return;
    if(!await isApprovedGuideConnection(request,env.DB))throw failure('발행 권한이 없습니다.',403);
  }else{
    if(write)sameOrigin(request);
    await requireAdmin(request,env);
  }
}
export const onRequestGet=safeHandler(async({request,env,params})=>{
  const query=new URL(request.url).searchParams,admin=query.get('admin')==='1';
  if(admin)await authorize(request,env,false);
  await initialize(env.DB);
  const slug=params.slug?.[0];
  if(slug){
    const guide=await read(env.DB,slug,admin);
    if(!guide)throw failure('글을 찾을 수 없습니다.',404);
    return json({...guide,images:JSON.parse(guide.images)});
  }
  const page=Math.min(100000,Math.max(1,parseInt(query.get('page'))||1));
  const rows=await list(env.DB,(query.get('q')||'').trim().slice(0,100),page,admin);
  return json({guides:rows.slice(0,20),more:rows.length>20});
});
export const onRequestPut=safeHandler(async({request,env,params})=>{
  await authorize(request,env,true);
  await initialize(env.DB);
  if(params.slug?.length!==1)throw failure('글 주소를 지정하세요.');
  return json(await save(env.DB,params.slug[0],await bodyJson(request)));
});
