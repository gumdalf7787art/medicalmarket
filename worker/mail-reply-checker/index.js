const syncUrl='https://medicalmarket.pages.dev/api/mail/supplier-replies/scheduled';

export default {
  async scheduled(_event,env,context){
    context.waitUntil((async()=>{
      if(!env.MAIL_SYNC_TOKEN||env.MAIL_SYNC_TOKEN.length<32)throw new Error('MAIL_SYNC_TOKEN is not configured');
      const response=await fetch(syncUrl,{
        method:'POST',
        headers:{Authorization:'Bearer '+env.MAIL_SYNC_TOKEN},
        signal:AbortSignal.timeout(120000)
      });
      if(!response.ok)throw new Error('Medical Market Gmail sync failed with HTTP '+response.status);
    })());
  },
  fetch(){return new Response('Not found',{status:404});}
};
