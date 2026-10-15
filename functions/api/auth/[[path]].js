import {safeHandler} from '../../../server/cloud.js';
import {authAction} from '../../../server/auth.js';
import {oauthAction,finishSocial} from '../../../server/oauth.js';
export const onRequest=safeHandler(context=>{
 const path=Array.isArray(context.params.path)?context.params.path.join('/'):context.params.path;
 if(path.startsWith('oauth/'))return oauthAction(context);
 if(path==='social'&&context.request.method==='POST')return finishSocial(context);
 return authAction(context);
});
