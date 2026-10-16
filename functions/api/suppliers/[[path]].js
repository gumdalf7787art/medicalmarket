import {safeHandler} from '../../../server/cloud.js';
import {supplierAction} from '../../../server/suppliers.js';
export const onRequest=safeHandler(supplierAction);
