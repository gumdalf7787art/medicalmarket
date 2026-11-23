import {safeHandler} from '../../server/cloud.js';
import {discoveryAction} from '../../server/discovery.js';
export const onRequest=safeHandler(discoveryAction);
