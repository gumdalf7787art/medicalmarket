import {productConnections} from '../../../server/guide-connections.js';
export const onRequestGet=productConnections.listConnections;
export const onRequestPost=productConnections.manageConnection;
