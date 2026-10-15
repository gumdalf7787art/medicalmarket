import {safeHandler} from '../../../server/cloud.js';
import {memberAction} from '../../../server/member.js';
export const onRequest=safeHandler(memberAction);
