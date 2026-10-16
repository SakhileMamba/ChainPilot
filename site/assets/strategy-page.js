// The interactive compounding explainer on strategy.html (the same component as in the app).
import config from './config.js';
import { mountExplainer } from './shared/web/explainer.js';

mountExplainer(document.getElementById('explainer'), { plan: { bet: 10, maxLoss: 100 }, rtp: config.rtp });
