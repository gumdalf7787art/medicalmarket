import {legacyProductRedirect} from '../../../../../server/legacy-product-links.js';
export const onRequest=context=>legacyProductRedirect(context);
