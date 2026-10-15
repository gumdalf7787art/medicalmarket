import {safeHandler} from '../../../server/cloud.js';
import {gmailAction} from '../../../server/gmail.js';
export const onRequest=safeHandler(gmailAction);
